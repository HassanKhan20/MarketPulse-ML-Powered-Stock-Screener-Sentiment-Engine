import { useEffect, useRef, useState } from 'react';

/** WebSocket to /ws with exponential-backoff reconnect. Handlers may change between renders. */
export function useMarketSocket(handlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const [status, setStatus] = useState('connecting');

  useEffect(() => {
    let ws;
    let retry = 0;
    let timer;
    let disposed = false;

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      setStatus(retry === 0 ? 'connecting' : 'reconnecting');
      ws.onopen = () => { retry = 0; setStatus('live'); handlersRef.current.open?.(); };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        handlersRef.current[msg.type]?.(msg.data);
      };
      ws.onclose = () => {
        if (disposed) return;
        setStatus('reconnecting');
        timer = setTimeout(connect, Math.min(10_000, 500 * 2 ** retry++));
      };
    };
    connect();
    return () => { disposed = true; clearTimeout(timer); ws?.close(); };
  }, []);

  return status;
}

export function useDebounced(value, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Returns 'up' | 'down' | '' for a short moment after `value` changes. */
export function useFlash(value) {
  const prev = useRef(value);
  const [flash, setFlash] = useState('');
  useEffect(() => {
    if (prev.current !== undefined && value !== prev.current) {
      setFlash(value > prev.current ? 'up' : 'down');
      const t = setTimeout(() => setFlash(''), 700);
      prev.current = value;
      return () => clearTimeout(t);
    }
    prev.current = value;
  }, [value]);
  return flash;
}

export function useInterval(fn, ms) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const id = setInterval(() => ref.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
}
