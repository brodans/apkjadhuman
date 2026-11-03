import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '../api';

const IMAGE_PROXY_PATH = '/api/proxy-image';
const IMAGE_SERVER_HOST = '103.109.206.102';
const IMAGE_CACHE_LIMIT = 60;
const IMAGE_CACHE_TTL_MS = 2 * 60 * 1000;
const resolvedImageCache = new Map<string, { source: string; expiresAt: number }>();
const pendingImageRequests = new Map<string, Promise<string>>();

export const resolveImageSource = async (source: string): Promise<string> => {
  if (!source || !isTauri() || source.startsWith('data:') || source.startsWith('blob:')) {
    return source;
  }

  let imagePath = '';
  let useBaseUrl = false;

  try {
    const url = new URL(source, window.location.origin);

    if (url.pathname === IMAGE_PROXY_PATH) {
      imagePath = url.searchParams.get('path') || '';
      useBaseUrl = url.searchParams.get('use_base_url') === 'true';
      if (/^https?:\/\//i.test(imagePath)) {
        const remoteUrl = new URL(imagePath);
        if (remoteUrl.hostname === IMAGE_SERVER_HOST && remoteUrl.port === '8087') {
          imagePath = `${remoteUrl.pathname}${remoteUrl.search}`;
        } else if (remoteUrl.hostname === 'presensi.ponorogo.go.id') {
          imagePath = `${remoteUrl.pathname}${remoteUrl.search}`;
          useBaseUrl = true;
        } else {
          return imagePath;
        }
      }
    } else if (url.protocol === 'http:' || url.protocol === 'https:') {
      if (url.hostname === IMAGE_SERVER_HOST && url.port === '8087') {
        imagePath = `${url.pathname}${url.search}`;
      } else if (url.hostname === 'presensi.ponorogo.go.id') {
        imagePath = `${url.pathname}${url.search}`;
        useBaseUrl = true;
      } else {
        return source;
      }
    } else {
      return source;
    }
  } catch {
    return source;
  }

  if (!imagePath) return source;
  const cacheKey = `${useBaseUrl ? 'https' : 'http'}:${imagePath}`;
  const cached = resolvedImageCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    resolvedImageCache.delete(cacheKey);
    resolvedImageCache.set(cacheKey, cached);
    return cached.source;
  }
  if (cached) resolvedImageCache.delete(cacheKey);

  const pendingRequest = pendingImageRequests.get(cacheKey);
  if (pendingRequest) return pendingRequest;

  const request = invoke<string>('absensi_image_proxy', { path: imagePath, useBaseUrl })
    .then((resolved) => {
      resolvedImageCache.set(cacheKey, {
        source: resolved,
        expiresAt: Date.now() + IMAGE_CACHE_TTL_MS,
      });
      if (resolvedImageCache.size > IMAGE_CACHE_LIMIT) {
        const oldestKey = resolvedImageCache.keys().next().value;
        if (oldestKey) resolvedImageCache.delete(oldestKey);
      }
      return resolved;
    })
    .finally(() => pendingImageRequests.delete(cacheKey));
  pendingImageRequests.set(cacheKey, request);
  return request;
};

export const useResolvedImageSource = (source: string): string => {
  const [resolvedSource, setResolvedSource] = useState(source);

  useEffect(() => {
    let active = true;
    setResolvedSource('');

    resolveImageSource(source)
      .then((resolved) => {
        if (active) setResolvedSource(resolved);
      })
      .catch(() => {
        if (active) setResolvedSource(source);
      });

    return () => {
      active = false;
    };
  }, [source]);

  return resolvedSource;
};
