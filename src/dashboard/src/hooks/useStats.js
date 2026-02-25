import { useEffect } from 'react';
import { API } from '../api.js';

export function useStats(dispatch) {
  useEffect(() => {
    function fetchStats() {
      fetch(API + '/api/logs/stats')
        .then(r => r.json())
        .then(s => dispatch({ type: 'SET_STATS', payload: s }))
        .catch(() => {});
    }

    fetchStats();
    const id = setInterval(fetchStats, 30000);
    return () => clearInterval(id);
  }, [dispatch]);
}
