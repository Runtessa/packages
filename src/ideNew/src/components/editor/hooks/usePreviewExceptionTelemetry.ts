import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { PreviewExceptionPayload } from '@/components/editor/page-types';

type Params = {
  apiFetch: (url: string, options?: { method?: string; body?: unknown }) => Promise<any>;
  previewFrameRef: RefObject<HTMLIFrameElement | null>;
  previewSession: string;
  previewName?: string;
  previewVersion?: string;
  tenantHost: string;
  batchDelayMs: number;
  dedupeWindowMs: number;
  maxQueueSize: number;
};

export const usePreviewExceptionTelemetry = ({
  apiFetch,
  previewFrameRef,
  previewSession,
  previewName,
  previewVersion,
  tenantHost,
  batchDelayMs,
  dedupeWindowMs,
  maxQueueSize,
}: Params) => {
  const queueRef = useRef<PreviewExceptionPayload[]>([]);
  const flushTimerRef = useRef<number | null>(null);
  const lastSeenRef = useRef<Record<string, number>>({});

  const flushPreviewExceptionQueue = useCallback(async () => {
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const queued = queueRef.current.splice(0, maxQueueSize);
    if (!queued.length) return;
    try {
      await apiFetch('/api/assistant/preview/exceptions', {
        method: 'POST',
        body: { events: queued },
      });
    } catch {
      // Keep preview telemetry non-blocking for editor UX.
    }
  }, [apiFetch, maxQueueSize]);

  useEffect(() => {
    const scheduleFlush = () => {
      if (flushTimerRef.current !== null) return;
      flushTimerRef.current = window.setTimeout(() => {
        void flushPreviewExceptionQueue();
      }, batchDelayMs);
    };

    const handlePreviewMessage = (event: MessageEvent) => {
      const frameWindow = previewFrameRef.current?.contentWindow;
      if (!frameWindow || event.source !== frameWindow) return;
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      const source = String((data as { source?: string }).source || '');
      if (source !== 'idp-preview-exception') return;

      const payloadCandidate = (data as { payload?: unknown }).payload;
      const payload =
        payloadCandidate && typeof payloadCandidate === 'object'
          ? (payloadCandidate as PreviewExceptionPayload)
          : null;
      if (!payload) return;

      const message = String(payload.message || '').trim();
      if (!message) return;
      if (payload.previewSession && payload.previewSession !== previewSession) return;

      const dedupeKey = [
        String(payload.kind || ''),
        message,
        String(payload.requestUrl || ''),
        String(payload.status ?? ''),
        String(payload.sourceUrl || ''),
        String(payload.line ?? ''),
        String(payload.column ?? ''),
      ].join('|');
      const now = Date.now();
      const lastSeen = lastSeenRef.current[dedupeKey] || 0;
      if (now - lastSeen < dedupeWindowMs) return;
      lastSeenRef.current[dedupeKey] = now;

      queueRef.current.push({
        id: payload.id,
        kind: payload.kind || 'runtime-error',
        level: payload.level || 'error',
        message,
        stack: payload.stack || '',
        sourceUrl: payload.sourceUrl || '',
        line:
          typeof payload.line === 'number' && Number.isFinite(payload.line)
            ? payload.line
            : null,
        column:
          typeof payload.column === 'number' && Number.isFinite(payload.column)
            ? payload.column
            : null,
        requestUrl: payload.requestUrl || '',
        method: payload.method || '',
        status:
          typeof payload.status === 'number' && Number.isFinite(payload.status)
            ? payload.status
            : null,
        responseSnippet: payload.responseSnippet || '',
        previewName: payload.previewName || previewName || '',
        previewVersion: payload.previewVersion || previewVersion || '',
        previewSession: payload.previewSession || previewSession,
        tenantHost: payload.tenantHost || tenantHost || '',
        href: payload.href || '',
        createdAt: payload.createdAt || new Date().toISOString(),
      });
      if (queueRef.current.length >= maxQueueSize) {
        void flushPreviewExceptionQueue();
        return;
      }
      scheduleFlush();
    };

    window.addEventListener('message', handlePreviewMessage);
    return () => {
      window.removeEventListener('message', handlePreviewMessage);
      void flushPreviewExceptionQueue();
    };
  }, [
    batchDelayMs,
    dedupeWindowMs,
    flushPreviewExceptionQueue,
    maxQueueSize,
    previewFrameRef,
    previewName,
    previewSession,
    previewVersion,
    tenantHost,
  ]);
};
