/**
 * MySearchPage - 页面世界导航/播放拦截钩子
 *
 * 这个文件不访问 chrome API，只负责在页面世界拦截 page script 发起的
 * window.open、history 路由和 HTMLMediaElement.play，并把可取消事件交给
 * 隔离世界的 blocking-controller.js 判断。
 */
(function installPageHook(global) {
  'use strict';

  if (global.__mySearchBlockingPageHookInstalled) return;
  global.__mySearchBlockingPageHookInstalled = true;

  const NAVIGATION_EVENT = 'mysearch-blocking-navigation-attempt';
  const MEDIA_EVENT = 'mysearch-blocking-media-attempt';

  function dispatchNavigation(url, navigationKind) {
    const event = new CustomEvent(NAVIGATION_EVENT, {
      bubbles: false,
      cancelable: true,
      detail: {
        url: url == null ? '' : String(url),
        navigationKind,
      },
    });
    global.dispatchEvent(event);
    return event.defaultPrevented;
  }

  function dispatchMediaAttempt(media) {
    const event = new CustomEvent(MEDIA_EVENT, {
      bubbles: true,
      cancelable: true,
      detail: { src: media?.currentSrc || media?.src || '' },
    });
    media.dispatchEvent(event);
    return event.defaultPrevented;
  }

  try {
    const originalOpen = global.open;
    if (typeof originalOpen === 'function') {
      global.open = function guardedOpen(url, ...args) {
        if (dispatchNavigation(url, 'window.open')) return null;
        return originalOpen.call(this, url, ...args);
      };
    }
  } catch (error) {
    // 某些页面会锁定 window.open；点击拦截仍由隔离世界负责。
  }

  for (const methodName of ['pushState', 'replaceState']) {
    try {
      const original = global.history?.[methodName];
      if (typeof original !== 'function') continue;
      global.history[methodName] = function guardedHistory(state, title, url) {
        if (dispatchNavigation(url, methodName)) return undefined;
        return original.call(this, state, title, url);
      };
    } catch (error) {
      // 页面可能阻止覆盖 history 方法；popstate 和点击拦截仍然有效。
    }
  }

  try {
    const mediaPrototype = global.HTMLMediaElement?.prototype;
    const originalPlay = mediaPrototype?.play;
    if (typeof originalPlay === 'function') {
      mediaPrototype.play = function guardedPlay(...args) {
        if (dispatchMediaAttempt(this)) {
          return Promise.reject(new DOMException('Playback blocked by MySearchPage', 'NotAllowedError'));
        }
        return originalPlay.apply(this, args);
      };
    }
  } catch (error) {
    // 播放按钮和隔离世界的 play 事件拦截仍然有效。
  }
})(window);
