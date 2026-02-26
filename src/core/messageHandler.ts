import { Channel } from '../channels/base';
import { TwilioVoiceChannel } from '../channels/voice';
import { UnifiedMessage } from './types';
import { Logger } from './logger';
import { Router } from './router';
import { Onboarding } from '../onboarding';
import { ApiServer } from '../api/server';
import { processInbound, processOutbound } from '../media/processor';
import { AppConfig, ServiceConfig } from '../config/types';

/** Normalize a sender identifier by stripping non-digit characters (for phone numbers). */
function normalizeSender(sender: string): string {
  return sender.replace(/[^0-9]/g, '');
}

/** Check if a sender is allowed by an allow list. Returns true if no list or list is empty. */
function isAllowed(sender: string, allowList?: string[]): boolean {
  if (!allowList || allowList.length === 0) return true;
  const normalized = normalizeSender(sender);
  return allowList.some(entry => normalizeSender(entry) === normalized);
}

/**
 * Check if a sender can interact with this channel at all (pre-routing).
 * Allowed if: channel has no allow list, OR channel allows them,
 * OR any service on this channel explicitly allows them (service overrides channel).
 */
function isAllowedForChannel(
  sender: string,
  channelAllowList: string[] | undefined,
  servicesOnChannel: ServiceConfig[],
): boolean {
  if (!channelAllowList || channelAllowList.length === 0) return true;
  if (isAllowed(sender, channelAllowList)) return true;
  // Service allow lists override channel — if any service allows this sender, let them through
  for (const svc of servicesOnChannel) {
    if (svc.allow_list && svc.allow_list.length > 0 && isAllowed(sender, svc.allow_list)) return true;
  }
  return false;
}

export interface MessageHandlerDeps {
  router: Router;
  apiServer: ApiServer;
  logger: Logger;
  onboarding?: Onboarding;
  config: AppConfig;
}

export function wireMessageHandler(channel: Channel, deps: MessageHandlerDeps): void {
  const { router, apiServer, logger, onboarding, config } = deps;

  channel.on('message', async (message: UnifiedMessage) => {
    message.channelName = channel.name;

    // Check if sender can interact with this channel at all.
    // A service-level allow list overrides the channel restriction,
    // so we also check service allow lists before blocking.
    const channelAllowList = (config.channels[channel.name] as any)?.allow_list as string[] | undefined;
    const servicesOnChannel = router.getServicesForChannel(channel.name);
    if (!isAllowedForChannel(message.from, channelAllowList, servicesOnChannel)) {
      logger.log({
        id: message.id,
        timestamp: Date.now(),
        channel: message.channel,
        from: message.from,
        senderName: message.senderName,
        text: message.text,
        type: message.type,
        route: 'blocked',
        status: 'blocked',
        latency: 0,
      });
      return;
    }

    // Try onboarding first for DMs (only in groups mode)
    const mode = router.getChannelMode(channel.name);
    if (onboarding && !message.groupId && mode === 'groups' && !(message as any)._resolvedWebhook) {
      const channelUnmatched = (config.channels[channel.name] as any)?.unmatched as 'list' | 'ignore' | undefined;
      const handled = await onboarding.handleDirectMessage(message, channelUnmatched);
      if (handled) {
        logger.log({
          id: message.id,
          timestamp: Date.now(),
          channel: message.channel,
          from: message.from,
          senderName: message.senderName,
          text: message.text,
          type: message.type,
          route: 'onboarding',
          status: 'success',
          latency: 0,
        });
        return;
      }

      // Check if Telegram user has a service mapping
      if (message.channel === 'telegram') {
        const webhook = onboarding.getTelegramServiceWebhook(message.from);
        if (webhook) {
          const replyTo = message.from;
          const replyUrl = apiServer.getReplyUrl(message.channel, replyTo);
          const { dispatchWebhook } = await import('./webhook');
          const startTime = Date.now();
          const response = await dispatchWebhook(webhook, message, replyUrl);
          logger.log({
            id: message.id,
            timestamp: Date.now(),
            channel: message.channel,
            from: message.from,
            senderName: message.senderName,
            text: message.text,
            type: message.type,
            route: webhook,
            responseText: response?.text,
            status: response ? 'success' : 'error',
            latency: Date.now() - startTime,
          });
          if (response) {
            await channel.send(replyTo, response);
          }
          return;
        }
      }
    }

    // STT: transcribe audio if configured for this service
    const serviceConfig = router.findServiceConfig(message);

    // Check allow list: service allow list overrides channel allow list.
    // If the service defines its own allow list, use it; otherwise fall back to channel's.
    const effectiveAllowList = (serviceConfig?.allow_list && serviceConfig.allow_list.length > 0)
      ? serviceConfig.allow_list
      : channelAllowList;
    if (!isAllowed(message.from, effectiveAllowList)) {
      logger.log({
        id: message.id,
        timestamp: Date.now(),
        channel: message.channel,
        from: message.from,
        senderName: message.senderName,
        text: message.text,
        type: message.type,
        route: 'blocked',
        status: 'blocked',
        latency: 0,
      });
      return;
    }

    let sttTranscription: string | undefined;
    if (serviceConfig) {
      const originalText = message.text;
      await processInbound(message, serviceConfig);
      if (message.type === 'audio' && message.text && message.text !== originalText) {
        sttTranscription = message.text;
      }
    }

    const replyTo = message.groupId || message.from;
    const replyUrl = apiServer.getReplyUrl(message.channel, replyTo);
    const { response: routedResponse, webhook: routedWebhook, latency } = await router.route(message, replyUrl);
    let response = routedResponse;

    // If no service matched, check channel's unmatched policy
    if (!response && !message.groupId) {
      const channelCfg = config.channels[channel.name];
      if (channelCfg?.unmatched === 'list') {
        const svcs = router.getNamedServicesForChannel(channel.name);
        if (svcs.length > 0) {
          const lines = svcs.map(({ name, config: svc }) => {
            if (svc.command) {
              const cmd = svc.command.startsWith('/') ? svc.command : `/${svc.command}`;
              return `• ${name} — use ${cmd}`;
            }
            if (svc.code) return `• ${name} — send "${svc.code.toUpperCase()}" to connect`;
            return `• ${name}`;
          });
          await channel.send(replyTo, { text: `Available services:\n${lines.join('\n')}` });
        }
      }
    }

    // TTS: convert text to speech when configured
    let ttsGenerated = false;
    let ttsError: string | undefined;
    if (response && serviceConfig) {
      const hadMedia = response.media;
      const result = await processOutbound(response, serviceConfig);
      response = result.response;
      ttsError = result.ttsError;
      if (!hadMedia && response.media) {
        ttsGenerated = true;
      }
    }

    // For endpoint channels in sync mode: if no response, send an error so the HTTP request doesn't hang
    if (!response && message.channel === 'endpoint') {
      response = routedWebhook
        ? { text: `Webhook ${routedWebhook} failed to respond`, _error: true }
        : { text: 'No service matched for this endpoint', _error: true };
    }

    // Send the response
    let sendError: string | undefined;
    if (response) {
      if (message.channel === 'voice' && (message as any)._callSid && channel instanceof TwilioVoiceChannel) {
        channel.setCallResponse((message as any)._callSid, response);
      } else {
        try {
          await channel.send(replyTo, response);
        } catch (sendErr: any) {
          sendError = sendErr?.message || String(sendErr);
          console.error(`[${channel.name}] Failed to send reply to ${replyTo}: ${sendError}`);
        }
      }
    }

    // Build response text for logging
    let logResponseText = response?.text;
    if (ttsError) {
      logResponseText = `${logResponseText ? logResponseText + '\n' : ''}[TTS failed: ${ttsError}]`;
    }
    if (sendError) {
      logResponseText = `${logResponseText ? logResponseText + '\n' : ''}[Delivery failed: ${sendError}]`;
    }

    logger.log({
      id: message.id,
      timestamp: Date.now(),
      channel: message.channel,
      from: message.from,
      senderName: message.senderName,
      text: message.text,
      type: message.type,
      groupId: message.groupId,
      groupName: message.groupName,
      route: routedWebhook,
      responseText: logResponseText,
      status: (sendError || ttsError || response?._error) ? 'error' : (!routedWebhook ? 'no-route' : (response ? 'success' : 'error')),
      latency,
      sttTranscription,
      ttsGenerated: ttsGenerated || undefined,
    });
  });
}
