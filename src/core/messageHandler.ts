import { Channel } from '../channels/base';
import { TwilioVoiceChannel } from '../channels/voice';
import { UnifiedMessage } from './types';
import { Logger } from './logger';
import { Router } from './router';
import { Onboarding } from '../onboarding';
import { ApiServer } from '../api/server';
import { processInbound, processOutbound } from '../media/processor';
import { AppConfig, ServiceConfig } from '../config/types';

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
      status: (sendError || ttsError) ? 'error' : (!routedWebhook ? 'no-route' : (response ? 'success' : 'error')),
      latency,
      sttTranscription,
      ttsGenerated: ttsGenerated || undefined,
    });
  });
}
