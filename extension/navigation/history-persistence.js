(function (root, factory) {
    const api = factory();
    root.SearchHistoryPersistence = api;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const STORAGE_KEY = 'searchHistory';
    const RECOVERY_KEY = 'searchHistoryPersistenceRecoveryNeeded';
    const LOCK_NAME = 'mysearch-search-history-persistence';
    let fallbackLock = Promise.resolve();

    function cloneHistory(history) {
        return history.map((item) => (item && typeof item === 'object' ? { ...item } : item));
    }

    function normalizeHistory(history) {
        if (!Array.isArray(history)) return [];

        return history.map((item) => {
            if (typeof item === 'string') {
                const now = new Date().toISOString();
                return {
                    keyword: item,
                    first_timestamp: now,
                    search_count: 1,
                    latest_timestamp: now
                };
            }
            return item && typeof item === 'object' ? { ...item } : item;
        }).filter((item) => item && typeof item === 'object');
    }

    function create({ indexedDB, localStorage, locks } = {}) {
        const adapter = indexedDB &&
            typeof indexedDB.init === 'function' &&
            typeof indexedDB.read === 'function' &&
            typeof indexedDB.write === 'function'
            ? indexedDB
            : null;
        const lockManager = locks || (
            typeof globalThis !== 'undefined' &&
            globalThis.navigator &&
            globalThis.navigator.locks
        );
        let history = [];
        let initAttempted = false;
        let indexedDBReady = false;

        function withExclusiveLock(operation) {
            if (lockManager && typeof lockManager.request === 'function') {
                return lockManager.request(LOCK_NAME, { mode: 'exclusive' }, operation);
            }

            const result = fallbackLock.then(operation);
            fallbackLock = result.then(() => undefined, () => undefined);
            return result;
        }

        function readMirror() {
            try {
                const raw = localStorage && localStorage.getItem(STORAGE_KEY);
                if (raw === null || raw === undefined) return { exists: false, history: [] };

                const parsed = JSON.parse(raw);
                if (!Array.isArray(parsed)) return { exists: false, history: [] };

                return { exists: true, history: normalizeHistory(parsed) };
            } catch (error) {
                console.warn('读取本地历史镜像失败:', error);
                return { exists: false, history: [] };
            }
        }

        function writeMirror() {
            if (!localStorage) return;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
        }

        function recoveryNeeded() {
            return Boolean(localStorage && localStorage.getItem(RECOVERY_KEY) === '1');
        }

        function markRecoveryNeeded() {
            if (localStorage) localStorage.setItem(RECOVERY_KEY, '1');
        }

        function clearRecoveryNeeded() {
            if (localStorage) localStorage.removeItem(RECOVERY_KEY);
        }

        async function initIndexedDB() {
            if (!adapter || initAttempted) return indexedDBReady;

            initAttempted = true;
            try {
                await adapter.init();
                indexedDBReady = true;
            } catch (error) {
                indexedDBReady = false;
                markRecoveryNeeded();
                console.warn('初始化历史 IndexedDB 失败，使用本地镜像:', error);
            }
            return indexedDBReady;
        }

        async function persist(operation) {
            let savedToIndexedDB = false;
            if (await initIndexedDB()) {
                try {
                    await adapter.write(operation, cloneHistory(history));
                    savedToIndexedDB = true;
                } catch (error) {
                    markRecoveryNeeded();
                    console.warn('写入历史 IndexedDB 失败，已保留本地镜像:', error);
                }
            }

            // IndexedDB 成功时同步镜像；失败时镜像仍是跨重开恢复来源。
            writeMirror();
            if (savedToIndexedDB) clearRecoveryNeeded();
        }

        async function readLatestHistory() {
            const mirror = readMirror();
            const ready = await initIndexedDB();

            // 上次数据库写入未完成时，镜像包含更晚的正确状态，优先恢复并尝试修复数据库。
            if (mirror.exists && recoveryNeeded()) {
                history = mirror.history;
                return { ready, recovery: true };
            }

            if (ready) {
                try {
                    history = normalizeHistory(await adapter.read());
                    return { ready, recovery: false, mirror };
                } catch (error) {
                    console.warn('读取历史 IndexedDB 失败，使用空历史:', error);
                }
            }

            history = mirror.exists ? mirror.history : [];
            return { ready, recovery: false, mirror };
        }

        async function load() {
            return withExclusiveLock(async () => {
                const latest = await readLatestHistory();

                if (latest.recovery) {
                    if (latest.ready) await persist('recovery');
                    return cloneHistory(history);
                }

                // 旧版仅 localStorage 的历史需要迁移到现在的主存储。
                if (
                    latest.ready &&
                    history.length === 0 &&
                    latest.mirror &&
                    latest.mirror.exists &&
                    latest.mirror.history.length > 0
                ) {
                    history = latest.mirror.history;
                    await persist('migration');
                } else {
                    writeMirror();
                }
                return cloneHistory(history);
            });
        }

        function getAll() {
            return cloneHistory(history);
        }

        async function add(keyword) {
            const normalizedKeyword = String(keyword || '').trim();
            if (!normalizedKeyword) return getAll();

            return withExclusiveLock(async () => {
                await readLatestHistory();

                const now = new Date().toISOString();
                const existingIndex = history.findIndex((item) => item.keyword === normalizedKeyword);
                if (existingIndex >= 0) {
                    const current = history[existingIndex];
                    const updated = {
                        ...current,
                        keyword: normalizedKeyword,
                        first_timestamp: current.first_timestamp || now,
                        search_count: (Number(current.search_count) || 1) + 1,
                        latest_timestamp: now
                    };
                    history.splice(existingIndex, 1);
                    history.unshift(updated);
                } else {
                    history.unshift({
                        keyword: normalizedKeyword,
                        first_timestamp: now,
                        search_count: 1,
                        latest_timestamp: now
                    });
                }

                await persist('add');
                return getAll();
            });
        }

        async function rename(oldKeyword, newKeyword) {
            const normalizedNewKeyword = String(newKeyword || '').trim();
            if (!normalizedNewKeyword) return getAll();

            return withExclusiveLock(async () => {
                await readLatestHistory();
                const oldIndex = history.findIndex((item) => item.keyword === oldKeyword);
                if (oldIndex < 0) return getAll();

                const renamed = { ...history[oldIndex], keyword: normalizedNewKeyword };
                history = history.filter((item, index) =>
                    index !== oldIndex && item.keyword !== normalizedNewKeyword
                );
                history.splice(Math.min(oldIndex, history.length), 0, renamed);

                await persist('rename');
                return getAll();
            });
        }

        async function remove(keyword) {
            return withExclusiveLock(async () => {
                await readLatestHistory();
                history = history.filter((item) => item.keyword !== keyword);
                await persist('remove');
                return getAll();
            });
        }

        async function importHistory(items) {
            return withExclusiveLock(async () => {
                await readLatestHistory();
                history = [...normalizeHistory(items), ...history];
                await persist('import');
                return getAll();
            });
        }

        async function restore(item) {
            return withExclusiveLock(async () => {
                await readLatestHistory();
                const restored = normalizeHistory([item])[0];
                if (restored && !history.some((entry) => entry.keyword === restored.keyword)) {
                    history.unshift(restored);
                }
                await persist('restore');
                return getAll();
            });
        }

        return { load, getAll, add, rename, remove, import: importHistory, restore };
    }

    return { create };
}));
