// 当前网站配置（从IndexedDB加载）
        let siteUrls = {};
        // 站点额外标志（右键/单开）
        let siteFlags = {}; // { [dataSite]: { rightClick: boolean, requireKeyword: boolean } }
        // 最近一次按钮配置（含标志）
        let buttonConfigState = [];

        // IndexedDB 数据库管理类
        class SiteConfigDB {
            constructor() {
                this.dbName = 'MySiteConfigDB';
                this.dbVersion = 1;
                this.storeName = 'siteConfig';
                this.db = null;
            }

            // 初始化数据库
            async init() {
                return new Promise((resolve, reject) => {
                    const request = indexedDB.open(this.dbName, this.dbVersion);
                    
                    request.onerror = () => reject(request.error);
                    request.onsuccess = () => {
                        this.db = request.result;
                        resolve();
                    };
                    
                    request.onupgradeneeded = (event) => {
                        const db = event.target.result;
                        if (!db.objectStoreNames.contains(this.storeName)) {
                            const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
                            store.createIndex('type', 'type', { unique: false });
                        }
                    };
                });
            }

            // 保存配置
            async saveConfig(config) {
                if (!this.db) await this.init();
                
                return new Promise((resolve, reject) => {
                    const transaction = this.db.transaction([this.storeName], 'readwrite');
                    const store = transaction.objectStore(this.storeName);
                    
                    const configData = {
                        id: 'main',
                        type: 'siteConfig',
                        data: config,
                        timestamp: Date.now()
                    };
                    
                    const request = store.put(configData);
                    request.onsuccess = () => resolve();
                    request.onerror = () => reject(request.error);
                });
            }

            // 读取配置
            async loadConfig() {
                if (!this.db) await this.init();
                
                return new Promise((resolve, reject) => {
                    const transaction = this.db.transaction([this.storeName], 'readonly');
                    const store = transaction.objectStore(this.storeName);
                    const request = store.get('main');
                    
                    request.onsuccess = () => {
                        if (request.result) {
                            resolve(request.result.data);
                        } else {
                            resolve(null);
                        }
                    };
                    request.onerror = () => reject(request.error);
                });
            }

            // 删除配置
            async deleteConfig() {
                if (!this.db) await this.init();
                
                return new Promise((resolve, reject) => {
                    const transaction = this.db.transaction([this.storeName], 'readwrite');
                    const store = transaction.objectStore(this.storeName);
                    const request = store.delete('main');
                    
                    request.onsuccess = () => resolve();
                    request.onerror = () => reject(request.error);
                });
            }

            // 导出配置为JSON文件
            async exportConfig() {
                const config = await this.loadConfig();
                if (config) {
                    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'SiteUrls.json';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                    return true;
                }
                return false;
            }

            // 从JSON文件导入配置
            async importConfig(file) {
                return new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = async (e) => {
                        try {
                            const content = e.target.result;
                            const config = JSON.parse(content);
                            
                            if (config.siteUrls && config.buttonConfig) {
                                await this.saveConfig(config);
                                resolve(config);
                            } else {
                                reject(new Error('配置文件格式不正确'));
                            }
                        } catch (error) {
                            reject(error);
                        }
                    };
                    reader.onerror = () => reject(new Error('文件读取失败'));
                    reader.readAsText(file, 'UTF-8');
                });
            }
        }

        // 历史记录IndexedDB管理类
        class SearchHistoryDB {
            constructor() {
                this.dbName = 'SearchHistoryDB';
                this.dbVersion = 1;
                this.storeName = 'searchHistory';
                this.db = null;
            }

            async init() {
                return new Promise((resolve, reject) => {
                    const request = indexedDB.open(this.dbName, this.dbVersion);
                    
                    request.onerror = () => reject(new Error('无法打开历史记录数据库'));
                    
                    request.onsuccess = (event) => {
                        this.db = event.target.result;
                        resolve();
                    };
                    
                    request.onupgradeneeded = (event) => {
                        const db = event.target.result;
                        
                        // 创建历史记录存储
                        if (!db.objectStoreNames.contains(this.storeName)) {
                            const store = db.createObjectStore(this.storeName, { keyPath: 'keyword' });
                            store.createIndex('latest_timestamp', 'latest_timestamp', { unique: false });
                            store.createIndex('first_timestamp', 'first_timestamp', { unique: false });
                            store.createIndex('search_count', 'search_count', { unique: false });
                        }
                    };
                });
            }

            async addHistory(keyword) {
                if (!this.db) await this.init();
                
                return new Promise((resolve, reject) => {
                    const transaction = this.db.transaction([this.storeName], 'readwrite');
                    const store = transaction.objectStore(this.storeName);
                    
                    // 先尝试获取现有记录
                    const getRequest = store.get(keyword);
                    
                    getRequest.onsuccess = () => {
                        const existingItem = getRequest.result;
                        let historyItem;
                        
                        if (existingItem) {
                            // 更新现有记录
                            historyItem = {
                                ...existingItem,
                                search_count: existingItem.search_count + 1,
                                latest_timestamp: new Date().toISOString()
                            };
                        } else {
                            // 创建新记录
                            historyItem = {
                                keyword: keyword,
                                first_timestamp: new Date().toISOString(),
                                search_count: 1,
                                latest_timestamp: new Date().toISOString()
                            };
                        }
                        
                        const putRequest = store.put(historyItem);
                        putRequest.onsuccess = () => resolve(historyItem);
                        putRequest.onerror = () => reject(new Error('添加历史记录失败'));
                    };
                    
                    getRequest.onerror = () => reject(new Error('查询历史记录失败'));
                });
            }

            async getAllHistory() {
                if (!this.db) await this.init();
                
                return new Promise((resolve, reject) => {
                    const transaction = this.db.transaction([this.storeName], 'readonly');
                    const store = transaction.objectStore(this.storeName);
                    const request = store.getAll();
                    
                    request.onsuccess = () => {
                        // 按最新时间戳排序
                        const history = request.result.sort((a, b) => 
                            new Date(b.latest_timestamp) - new Date(a.latest_timestamp)
                        );
                        resolve(history);
                    };
                    
                    request.onerror = () => reject(new Error('获取历史记录失败'));
                });
            }

            async removeHistory(keyword) {
                if (!this.db) await this.init();
                
                return new Promise((resolve, reject) => {
                    const transaction = this.db.transaction([this.storeName], 'readwrite');
                    const store = transaction.objectStore(this.storeName);
                    const request = store.delete(keyword);
                    
                    request.onsuccess = () => resolve();
                    request.onerror = () => reject(new Error('删除历史记录失败'));
                });
            }

            async updateHistory(oldKeyword, newKeyword) {
                if (!this.db) await this.init();
                
                return new Promise((resolve, reject) => {
                    const transaction = this.db.transaction([this.storeName], 'readwrite');
                    const store = transaction.objectStore(this.storeName);
                    
                    // 先获取旧记录
                    const getRequest = store.get(oldKeyword);
                    
                    getRequest.onsuccess = () => {
                        const oldItem = getRequest.result;
                        if (oldItem) {
                            // 删除旧记录
                            store.delete(oldKeyword);
                            
                            // 添加新记录（保留原有数据）
                            const newItem = {
                                ...oldItem,
                                keyword: newKeyword
                            };
                            
                            const putRequest = store.put(newItem);
                            putRequest.onsuccess = () => resolve();
                            putRequest.onerror = () => reject(new Error('更新历史记录失败'));
                        } else {
                            reject(new Error('未找到要更新的历史记录'));
                        }
                    };
                    
                    getRequest.onerror = () => reject(new Error('查询历史记录失败'));
                });
            }

            async clearAllHistory() {
                if (!this.db) await this.init();
                
                return new Promise((resolve, reject) => {
                    const transaction = this.db.transaction([this.storeName], 'readwrite');
                    const store = transaction.objectStore(this.storeName);
                    const request = store.clear();
                    
                    request.onsuccess = () => resolve();
                    request.onerror = () => reject(new Error('清空历史记录失败'));
                });
            }

            async importHistory(historyArray) {
                if (!this.db) await this.init();
                
                return new Promise((resolve, reject) => {
                    const transaction = this.db.transaction([this.storeName], 'readwrite');
                    const store = transaction.objectStore(this.storeName);
                    
                    let completed = 0;
                    let errors = 0;
                    
                    if (historyArray.length === 0) {
                        resolve();
                        return;
                    }
                    
                    historyArray.forEach(item => {
                        const request = store.put(item);
                        
                        request.onsuccess = () => {
                            completed++;
                            if (completed + errors === historyArray.length) {
                                if (errors === 0) {
                                    resolve();
                                } else {
                                    reject(new Error(`导入完成，但有 ${errors} 条记录失败`));
                                }
                            }
                        };
                        
                        request.onerror = () => {
                            errors++;
                            if (completed + errors === historyArray.length) {
                                reject(new Error(`导入失败，有 ${errors} 条记录失败`));
                            }
                        };
                    });
                });
            }

            async writeHistory(historyArray) {
                if (!this.db) await this.init();

                return new Promise((resolve, reject) => {
                    const transaction = this.db.transaction([this.storeName], 'readwrite');
                    const store = transaction.objectStore(this.storeName);
                    const snapshot = Array.isArray(historyArray) ? historyArray : [];

                    transaction.oncomplete = () => resolve();
                    transaction.onerror = () => reject(transaction.error || new Error('保存历史记录失败'));
                    transaction.onabort = () => reject(transaction.error || new Error('保存历史记录失败'));

                    store.clear();
                    snapshot.forEach((item) => store.put(item));
                });
            }

            async migrateFromLocalStorage() {
                try {
                    const localStorageData = localStorage.getItem('searchHistory');
                    if (localStorageData) {
                        const parsed = JSON.parse(localStorageData);
                        if (Array.isArray(parsed) && parsed.length > 0) {
                            // 确保数据格式正确
                            const normalizedData = parsed.map(item => {
                                if (typeof item === 'string') {
                                    // 旧格式：字符串数组
                                    return {
                                        keyword: item,
                                        first_timestamp: new Date().toISOString(),
                                        search_count: 1,
                                        latest_timestamp: new Date().toISOString()
                                    };
                                } else if (item && typeof item === 'object' && item.keyword) {
                                    // 新格式或部分格式化的数据
                                    return {
                                        keyword: item.keyword,
                                        first_timestamp: item.first_timestamp || new Date().toISOString(),
                                        search_count: item.search_count || 1,
                                        latest_timestamp: item.latest_timestamp || new Date().toISOString()
                                    };
                                }
                                return null;
                            }).filter(item => item !== null);
                            
                            if (normalizedData.length > 0) {
                                await this.importHistory(normalizedData);
                                // 迁移成功后删除localStorage数据
                                localStorage.removeItem('searchHistory');
                                return true;
                            }
                        }
                    }
                    return false;
                } catch (error) {
                    console.error('从localStorage迁移失败:', error);
                    return false;
                }
            }
        }

        // 全局数据库实例
        const siteConfigDB = new SiteConfigDB();
        const searchHistoryDB = new SearchHistoryDB();
        const historyPersistence = SearchHistoryPersistence.create({
            indexedDB: {
                init: () => searchHistoryDB.init(),
                read: () => searchHistoryDB.getAllHistory(),
                write: (_operation, history) => searchHistoryDB.writeHistory(history)
            },
            localStorage
        });

        // 从IndexedDB加载网站配置
        async function loadSiteConfig() {
            try {
                // 首先尝试从IndexedDB读取
                const config = await siteConfigDB.loadConfig();
                if (config && config.siteUrls && config.buttonConfig) {
                    siteUrls = config.siteUrls;
                    // 恢复按钮配置与站点标志
                    buttonConfigState = config.buttonConfig || [];
                    siteFlags = config.siteFlags || {};
                    // 为缺失标志的站点补默认值
                    Object.keys(siteUrls).forEach(k => {
                        if (!siteFlags[k]) siteFlags[k] = { rightClick: false, allowBlank: false, requireKeyword: true };
                    });
                    applyButtonConfig(buttonConfigState);
                    return;
                }

                // 如果IndexedDB中没有配置，尝试从localStorage迁移
                const localConfig = localStorage.getItem('siteConfig');
                if (localConfig) {
                    const parsedConfig = JSON.parse(localConfig);
                    if (parsedConfig.siteUrls && parsedConfig.buttonConfig) {
                        // 迁移到IndexedDB
                        // 兼容旧数据：没有siteFlags则生成默认
                        const migrated = {
                            siteUrls: parsedConfig.siteUrls,
                            buttonConfig: parsedConfig.buttonConfig,
                            siteFlags: parsedConfig.siteFlags || {}
                        };
                        Object.keys(migrated.siteUrls).forEach(k => {
                            if (!migrated.siteFlags[k]) migrated.siteFlags[k] = { rightClick: false, allowBlank: false, requireKeyword: true };
                        });
                        await siteConfigDB.saveConfig(migrated);
                        siteUrls = migrated.siteUrls;
                        buttonConfigState = migrated.buttonConfig;
                        siteFlags = migrated.siteFlags;
                        applyButtonConfig(buttonConfigState);
                        // 清除localStorage中的旧数据
                        localStorage.removeItem('siteConfig');
                        alert('已将配置从localStorage迁移到IndexedDB！数据更安全了。');
                        return;
                    }
                }

                // 使用插件内置默认配置初始化新的扩展资料。
                const bundledResponse = await fetch(chrome.runtime.getURL('navigation/SiteUrls.json'));
                if (!bundledResponse.ok) {
                    throw new Error('内置网站配置不可用');
                }
                const bundledConfig = await bundledResponse.json();
                if (!bundledConfig || !bundledConfig.siteUrls || !bundledConfig.buttonConfig) {
                    throw new Error('内置网站配置格式不正确');
                }
                siteUrls = bundledConfig.siteUrls;
                buttonConfigState = bundledConfig.buttonConfig || [];
                siteFlags = bundledConfig.siteFlags || {};
                Object.keys(siteUrls).forEach(k => {
                    if (!siteFlags[k]) siteFlags[k] = { rightClick: false, allowBlank: false, requireKeyword: true };
                });
                await siteConfigDB.saveConfig({ siteUrls, buttonConfig: buttonConfigState, siteFlags });
                applyButtonConfig(buttonConfigState);
                
            } catch (error) {
                showConfigLoadError();
            }
        }

        // Options 页保存或导入后，已打开的导航页直接重读共享 IndexedDB。
        chrome.runtime.onMessage.addListener((message) => {
            if (message && message.type === 'SITE_CONFIG_UPDATED') {
                loadSiteConfig();
            }
        });

        // 兼容通过 chrome.storage 广播配置版本的 Options 实现。
        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName === 'local' && (
                changes.siteConfigUpdatedAt ||
                changes.siteConfigRevision ||
                changes.navigationConfigRevision
            )) {
                loadSiteConfig();
            }
        });



        // 显示配置加载错误提示
        function showConfigLoadError() {
            const btnGroup = document.querySelector('.btn-group');
            btnGroup.innerHTML = `
                <div style="padding: 20px; text-align: center; color: #666;">
                    <p>未找到网站配置，请前往插件设置进行配置。</p>
                    <button id="open-settings" style="margin: 5px;">手动设置</button>
                    <p style="font-size: 12px; margin-top: 10px;">
                        使用IndexedDB进行本地存储，配置将自动保存，无需下载文件
                    </p>
                </div>
            `;
            
            // 绑定事件
            document.getElementById('open-settings').addEventListener('click', () => {
                openExtensionOptions();
            });
        }

        function openExtensionOptions() {
            return chrome.runtime.openOptionsPage();
        }



        // 应用按钮配置
        function applyButtonConfig(buttonConfig) {
            const btnGroup = document.querySelector('.btn-group');
            if (btnGroup) {
                btnGroup.innerHTML = '';
                // 缓存状态
                buttonConfigState = buttonConfig || [];
                
                buttonConfigState.forEach((btnConfig, index) => {
                    const button = document.createElement('button');
                    button.textContent = btnConfig.name;
                    button.className = 'draggable-button';
                    button.draggable = true;
                    button.dataset.index = index;
                    
                    // 兼容性处理：支持旧格式的 datasite 和新格式的 dataSite
                    const dataSite = btnConfig.dataSite || btnConfig.datasite;
                    button.setAttribute('data-site', dataSite);
                    
                    if (btnConfig.isSmall) {
                        button.classList.add('small');
                    }
                    // 设置右键与单开(允许空白)状态供插件读取
                    const flags = siteFlags[dataSite] || {};
                    const allowBlank = !!flags.allowBlank;
                    button.setAttribute('data-rightclick', String(!!flags.rightClick));
                    button.setAttribute('data-allowblank', String(!!allowBlank));
                    // 兼容旧插件读取
                    button.setAttribute('data-requirekeyword', String(!allowBlank));
                    // 允许主页面高亮逻辑风格，复用 highlight 类
                    button.addEventListener('focus', () => button.classList.add('highlight'));
                    button.addEventListener('blur', () => button.classList.remove('highlight'));
                    
                    // 添加拖拽事件
                    button.addEventListener('dragstart', handleButtonDragStart);
                    button.addEventListener('dragover', handleButtonDragOver);
                    button.addEventListener('drop', handleButtonDrop);
                    button.addEventListener('dragend', handleButtonDragEnd);
                    button.addEventListener('dragenter', handleButtonDragEnter);
                    button.addEventListener('dragleave', handleButtonDragLeave);
                    
                    btnGroup.appendChild(button);
                });

                // 重新绑定按钮事件
                if (typeof bindButtonEvents === 'function') {
                    bindButtonEvents();
                }
                
                // 所有按钮统一使用16px字体，无需动态调整
            }
        }



        // 保存网站配置到IndexedDB
        async function saveSiteConfigLocally(config) {
            try {
                await siteConfigDB.saveConfig(config);
                // 不再自动下载文件，用户需要时可以手动导出
            } catch (error) {
                alert('保存配置失败: ' + error.message);
                throw error;
            }
        }

        // 填充设置表格数据
        function populateSettingsTable() {
            const tbody = document.getElementById('sites-table-body');
            if (!tbody) return;
            
            tbody.innerHTML = '';
            
            // 使用buttonConfigState的顺序来排序，如果不存在则使用原顺序
            const sortedEntries = [];
            if (buttonConfigState && buttonConfigState.length > 0) {
                // 按buttonConfigState的顺序排序
                buttonConfigState.forEach(btnConfig => {
                    const dataSite = btnConfig.dataSite || btnConfig.datasite;
                    if (siteUrls[dataSite]) {
                        sortedEntries.push([dataSite, siteUrls[dataSite]]);
                    }
                });
                // 添加不在buttonConfigState中的网站
            for (const [site, url] of Object.entries(siteUrls)) {
                    if (!sortedEntries.find(entry => entry[0] === site)) {
                        sortedEntries.push([site, url]);
                    }
                }
            } else {
                sortedEntries.push(...Object.entries(siteUrls));
            }
            
            sortedEntries.forEach(([site, url], index) => {
                const row = document.createElement('tr');
                row.className = 'draggable-row';
                row.draggable = true;
                row.dataset.site = site;
                row.dataset.index = index;
                
                // 添加拖拽手柄到第一列
                const nameCell = document.createElement('td');
                const dragHandle = document.createElement('span');
                dragHandle.className = 'drag-handle';
                dragHandle.innerHTML = '⋮⋮';
                dragHandle.title = '拖拽排序';
                
                const nameInput = document.createElement('input');
                nameInput.type = 'text';
                nameInput.value = document.querySelector(`button[data-site="${site}"]`)?.textContent || site;
                nameInput.style.width = 'calc(100% - 20px)';
                nameInput.style.marginLeft = '4px';
                
                nameCell.appendChild(dragHandle);
                nameCell.appendChild(nameInput);
                
                const siteCell = document.createElement('td');
                const siteInput = document.createElement('input');
                siteInput.type = 'text';
                siteInput.value = site;
                siteInput.style.width = '100%';
                siteCell.appendChild(siteInput);
                
                const urlCell = document.createElement('td');
                const urlInput = document.createElement('input');
                urlInput.type = 'text';
                urlInput.value = url;
                urlInput.style.width = '100%';
                urlCell.appendChild(urlInput);

                // 右键状态（二状态复选框）
                const rightCell = document.createElement('td');
                const rf = siteFlags[site] || {};
                const rightInput = createTwoStateCheckbox(!!rf.rightClick);
                rightCell.appendChild(rightInput);
                
                // 单开状态（三状态复选框）
                const requireCell = document.createElement('td');
                const currentMode = getSiteMode(site);
                const requireInput = createThreeStateCheckbox(currentMode);
                requireCell.appendChild(requireInput);
                
                // 桌面/手机状态（二状态复选框）
                const desktopCell = document.createElement('td');
                const desktopMode = rf.desktopMode !== undefined ? rf.desktopMode : true; // 默认为桌面端
                const desktopInput = createDesktopMobileCheckbox(desktopMode);
                desktopCell.appendChild(desktopInput);
                
                const actionCell = document.createElement('td');
                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'delete-btn';
                deleteBtn.textContent = '删除';
                deleteBtn.addEventListener('click', () => row.remove());
                actionCell.appendChild(deleteBtn);
                
                row.appendChild(nameCell);
                row.appendChild(siteCell);
                row.appendChild(urlCell);
                row.appendChild(rightCell);
                row.appendChild(requireCell);
                row.appendChild(desktopCell);
                row.appendChild(actionCell);
                tbody.appendChild(row);

                // 行选中（点击空白处）
                row.addEventListener('click', (e) => {
                    if (e.target.closest('input,button,.drag-handle')) return;
                    row.classList.toggle('selected');
                });
                
                // 拖拽事件
                row.addEventListener('dragstart', handleTableDragStart);
                row.addEventListener('dragover', handleTableDragOver);
                row.addEventListener('drop', handleTableDrop);
                row.addEventListener('dragend', handleTableDragEnd);
                row.addEventListener('dragenter', handleTableDragEnter);
                row.addEventListener('dragleave', handleTableDragLeave);
            });
        }

        // 表格拖拽功能相关变量
        let draggedTableRow = null;

        // 表格拖拽事件处理函数
        function handleTableDragStart(e) {
            draggedTableRow = this;
            this.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/html', this.outerHTML);
        }

        function handleTableDragOver(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        }

        function handleTableDragEnter(e) {
            e.preventDefault();
            if (this !== draggedTableRow) {
                this.classList.add('drag-over');
            }
        }

        function handleTableDragLeave(e) {
            e.preventDefault();
            // 只有当鼠标完全离开当前元素时才移除样式
            if (!this.contains(e.relatedTarget)) {
                this.classList.remove('drag-over');
            }
        }

        function handleTableDrop(e) {
            e.preventDefault();
            if (this !== draggedTableRow) {
                const tbody = this.parentNode;
                const draggedIndex = Array.from(tbody.children).indexOf(draggedTableRow);
                const targetIndex = Array.from(tbody.children).indexOf(this);
                
                if (draggedIndex < targetIndex) {
                    tbody.insertBefore(draggedTableRow, this.nextSibling);
                } else {
                    tbody.insertBefore(draggedTableRow, this);
                }
                
                // 更新行的data-index属性
                Array.from(tbody.children).forEach((row, index) => {
                    row.dataset.index = index;
                });
                
                // 更新buttonConfigState顺序
                updateButtonConfigOrder();
            }
            this.classList.remove('drag-over');
        }

        function handleTableDragEnd(e) {
            this.classList.remove('dragging');
            // 移除所有drag-over样式
            document.querySelectorAll('.drag-over').forEach(el => {
                el.classList.remove('drag-over');
            });
            draggedTableRow = null;
        }

        // 更新按钮配置顺序
        function updateButtonConfigOrder() {
            const tbody = document.getElementById('sites-table-body');
            if (!tbody) return;
            
            const newButtonConfig = [];
            Array.from(tbody.children).forEach(row => {
                const site = row.dataset.site;
                const existingConfig = buttonConfigState.find(config => 
                    (config.dataSite || config.datasite) === site
                );
                
                if (existingConfig) {
                    newButtonConfig.push(existingConfig);
                } else {
                    // 为新网站创建默认配置
                    const nameInput = row.querySelector('td:first-child input');
                    newButtonConfig.push({
                        name: nameInput ? nameInput.value : site,
                        dataSite: site,
                        isSmall: false
                    });
                }
            });
            
            buttonConfigState = newButtonConfig;
            // 立即更新主界面按钮顺序
            applyButtonConfig(buttonConfigState);
            
            // 自动保存新顺序到IndexedDB
            saveSiteConfigLocally({ 
                siteUrls, 
                buttonConfig: buttonConfigState, 
                siteFlags 
            }).then(() => {
                console.log('设置表格拖拽顺序已保存：', newButtonConfig.map(b => b.name));
            }).catch(error => {
                console.error('保存表格拖拽顺序失败:', error);
            });
        }

        // 主界面按钮拖拽功能相关变量
        let draggedButton = null;

        // 主界面按钮拖拽事件处理函数
        function handleButtonDragStart(e) {
            // 阻止触发点击事件
            e.stopPropagation();
            draggedButton = this;
            this.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/html', this.outerHTML);
        }

        function handleButtonDragOver(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        }

        function handleButtonDragEnter(e) {
            e.preventDefault();
            if (this !== draggedButton) {
                this.classList.add('drag-over-button');
            }
        }

        function handleButtonDragLeave(e) {
            e.preventDefault();
            if (!this.contains(e.relatedTarget)) {
                this.classList.remove('drag-over-button');
            }
        }

        function handleButtonDrop(e) {
            e.preventDefault();
            e.stopPropagation();
            if (this !== draggedButton) {
                const btnGroup = this.parentNode;
                const draggedIndex = Array.from(btnGroup.children).indexOf(draggedButton);
                const targetIndex = Array.from(btnGroup.children).indexOf(this);
                
                if (draggedIndex < targetIndex) {
                    btnGroup.insertBefore(draggedButton, this.nextSibling);
                } else {
                    btnGroup.insertBefore(draggedButton, this);
                }
                
                // 更新按钮的data-index属性
                Array.from(btnGroup.children).forEach((btn, index) => {
                    btn.dataset.index = index;
                });
                
                // 更新buttonConfigState顺序
                updateButtonConfigFromDOM();
            }
            this.classList.remove('drag-over-button');
        }

        function handleButtonDragEnd(e) {
            this.classList.remove('dragging');
            // 移除所有drag-over样式
            document.querySelectorAll('.drag-over-button').forEach(el => {
                el.classList.remove('drag-over-button');
            });
            draggedButton = null;
        }

        // 从DOM更新按钮配置顺序
        function updateButtonConfigFromDOM() {
            const btnGroup = document.querySelector('.btn-group');
            if (!btnGroup) return;
            
            const newButtonConfig = [];
            Array.from(btnGroup.children).forEach(button => {
                const dataSite = button.getAttribute('data-site');
                const existingConfig = buttonConfigState.find(config => 
                    (config.dataSite || config.datasite) === dataSite
                );
                
                if (existingConfig) {
                    newButtonConfig.push(existingConfig);
                } else {
                    // 为新按钮创建默认配置
                    newButtonConfig.push({
                        name: button.textContent,
                        dataSite: dataSite,
                        isSmall: button.classList.contains('small')
                    });
                }
            });
            
            buttonConfigState = newButtonConfig;
            
            // 自动保存新顺序到IndexedDB
            saveSiteConfigLocally({ 
                siteUrls, 
                buttonConfig: buttonConfigState, 
                siteFlags 
            }).then(() => {
                console.log('主界面按钮顺序已保存：', newButtonConfig.map(b => b.name));
            }).catch(error => {
                console.error('保存按钮顺序失败:', error);
            });
        }

        // 已移除linkButtons，所有按钮统一使用三状态逻辑
        
        // 判断URL是否需要拼接关键词（替代linkButtons逻辑）
        function shouldAppendKeyword(url) {
            if (!url) return false;
            const u = url.trim();
            // 包含通用占位符或常见查询参数，需要拼接关键词
            if (u.includes('%s') || u.endsWith('?') || u.includes('q=') || u.includes('search=') || u.includes('keyword=') || u.endsWith('wd=') || u.endsWith('query=')) {
                return true;
            }
            // 支持基于路径的搜索URL（如 /search/ 或 /so/ 结尾）
            if (/(^https?:\/\/)?[^?#]+\/(search|so)\/$/.test(u)) {
                return true;
            }
            return false;
        }

        // 规范化关键词：去除结尾空白与零宽字符
        function sanitizeKeyword(key) {
            return (key || '').replace(/[\s\u200B\u200C\u200D\uFEFF]+$/g, '');
        }

        // 统一构建搜索URL（支持站点定制）
        function buildSearchUrl(site, siteUrl, keyword, needsKeyword) {
            // 抖音：优先使用路径风格 /search/{keyword} ，附带稳定参数触发结果渲染
            if (site === 'douyin') {
                const base = 'https://www.douyin.com/search/';
                if (keyword) {
                    const safe = sanitizeKeyword(keyword);
                    const encoded = encodeURIComponent(safe).replace(/%+$/, '');
                    return base + encoded + '?type=general&source=normal_search';
                }
                return base;
            }

            if (keyword) {
                return needsKeyword ? (siteUrl + encodeURIComponent(keyword)) : siteUrl;
            }
            return needsKeyword ? siteUrl.replace(/\?.*$/, '') : siteUrl;
        }

        // 三状态枚举定义
        const SITE_MODES = {
            NO_BLANK: 0,      // 禁止单开（必须有关键词）
            BOTH: 1,          // 既能单开也能搜索  
            BLANK_ONLY: 2     // 只能单开（只能无关键词访问）
        };

        // 三状态显示文本 - Unicode标准符号版
        const STATE_SYMBOLS = {
            0: '☒',  // 禁止单开 - U+2612 BALLOT BOX WITH X
            1: '☑',  // 允许单开和搜索 - U+2611 BALLOT BOX WITH CHECK  
            2: '●'   // 只能单开 - U+25CF BLACK CIRCLE
        };
        
        // 状态提示文本
        const STATE_TOOLTIPS = {
            0: '禁止单开（必须有关键词）',
            1: '既能单开也能搜索',
            2: '只能单开（无关键词访问）'
        };

        // 创建三状态复选框
        function createThreeStateCheckbox(initialState = 0) {
            const checkbox = document.createElement('div');
            checkbox.className = 'three-state-checkbox';
            checkbox.setAttribute('data-state', initialState);
            checkbox.textContent = STATE_SYMBOLS[initialState];
            checkbox.title = STATE_TOOLTIPS[initialState]; // 添加工具提示
            
            // 点击切换状态
            checkbox.addEventListener('click', function() {
                const currentState = parseInt(this.getAttribute('data-state'));
                const nextState = (currentState + 1) % 3;
                this.setAttribute('data-state', nextState);
                this.textContent = STATE_SYMBOLS[nextState];
                this.title = STATE_TOOLTIPS[nextState]; // 更新工具提示
            });
            
            return checkbox;
        }
        
        // 创建二状态复选框（右键用）
        function createTwoStateCheckbox(initialChecked = false) {
            const checkbox = document.createElement('div');
            checkbox.className = 'two-state-checkbox';
            checkbox.setAttribute('data-checked', initialChecked ? '1' : '0');
            checkbox.textContent = initialChecked ? '☑' : '☒';
            checkbox.title = initialChecked ? '启用右键' : '禁用右键';
            
            // 点击切换状态
            checkbox.addEventListener('click', function() {
                const currentChecked = this.getAttribute('data-checked') === '1';
                const nextChecked = !currentChecked;
                this.setAttribute('data-checked', nextChecked ? '1' : '0');
                this.textContent = nextChecked ? '☑' : '☒';
                this.title = nextChecked ? '启用右键' : '禁用右键';
            });
            
            return checkbox;
        }

        // 创建桌面/手机复选框
        function createDesktopMobileCheckbox(isDesktop = true) {
            const checkbox = document.createElement('div');
            checkbox.className = 'two-state-checkbox';
            checkbox.setAttribute('data-desktop', isDesktop ? '1' : '0');
            checkbox.textContent = isDesktop ? '🖥' : '📱';
            checkbox.title = isDesktop ? '桌面端网站' : '手机端网站';
            
            // 点击切换状态
            checkbox.addEventListener('click', function() {
                const currentDesktop = this.getAttribute('data-desktop') === '1';
                const nextDesktop = !currentDesktop;
                this.setAttribute('data-desktop', nextDesktop ? '1' : '0');
                this.textContent = nextDesktop ? '🖥' : '📱';
                this.title = nextDesktop ? '桌面端网站' : '手机端网站';
            });
            
            return checkbox;
        }

        // 获取网站的单开模式
        function getSiteMode(site) {
            if (!siteFlags || !siteFlags[site]) {
                return SITE_MODES.NO_BLANK; // 默认禁止单开
            }
            
            const flags = siteFlags[site];
            
            // 新格式：如果有mode字段直接返回
            if (typeof flags.mode === 'number') {
                return flags.mode;
            }
            
            // 兼容旧格式：从allowBlank转换
            if (typeof flags.allowBlank === 'boolean') {
                return flags.allowBlank ? SITE_MODES.BOTH : SITE_MODES.NO_BLANK;
            }
            
            // 兼容更旧格式：从requireKeyword转换
            if (typeof flags.requireKeyword === 'boolean') {
                return flags.requireKeyword ? SITE_MODES.NO_BLANK : SITE_MODES.BOTH;
            }
            
            return SITE_MODES.NO_BLANK;
        }

        // 设置网站的单开模式
        function setSiteMode(site, mode) {
            if (!siteFlags) siteFlags = {};
            if (!siteFlags[site]) siteFlags[site] = {};
            
            siteFlags[site].mode = mode;
            
            // 为了兼容性，同时设置旧字段
            siteFlags[site].allowBlank = (mode === SITE_MODES.BOTH);
            siteFlags[site].requireKeyword = (mode === SITE_MODES.NO_BLANK);
        }

        // 动态获取网站列表
        function getAllSites() {
            return Object.keys(siteUrls);
        }

        // 获取DOM元素
        const searchInput = document.getElementById('search-input');
        const historyList = document.getElementById('history-list');
        const saveOnlyBtn = document.getElementById('save-only');
        const allSitesBtn = document.getElementById('all-sites');
        const commonSitesBtn = document.getElementById('common-sites');
        const foreignSitesBtn = document.getElementById('foreign-sites');
        const editHistoryBtn = document.getElementById('edit-history');
        const exportHistoryBtn = document.getElementById('export-history');
        const importHistoryBtn = document.getElementById('import-history');
        const clearInputBtn = document.querySelector('.clear-input');
        const editHistoryModal = document.getElementById('edit-history-modal');
        const historyEditInput = document.getElementById('history-edit-input');
        const saveEditBtn = document.getElementById('save-edit');
        const errorModal = document.getElementById('error-modal');
        const quicksearchinput = document.getElementById('quick-search-input');
        const mobileEscBtn = document.getElementById('mobile-esc-btn');

        // 网站设置已经迁移到插件 Options 页面；保留空值只为兼容下方主页面快捷键判断。
        const settingsModal = null;
        const settingsSearchInput = null;
        let historyItems = []; // 恢复显示
        let searchHistory = []; // 历史记录数组
        const historymatches = []; // 匹配项列表
        // 导航相关变量
        let currentFocusElement = null;
        let selectedElements = [];
        let lastDeletedItems = [];
        let quickSearchActive = false;

        // 增强的光标定位功能
        let lastInputValue = ''; // 记录最后输入的内容
        let lastCursorPosition = 0; // 记录最后的光标位置
        
        // 设置光标位置到指定位置
        function setCursorPosition(element, position) {
            if (element && element.setSelectionRange) {
                element.focus();
                // 延迟设置光标位置，确保元素已获得焦点
                setTimeout(() => {
                    element.setSelectionRange(position, position);
                }, 0);
            }
        }
        
        // 获取当前光标位置
        function getCursorPosition(element) {
            if (element && element.selectionStart !== undefined) {
                return element.selectionStart;
            }
            return 0;
        }
        
        // 增强的搜索框焦点处理函数
        function enhancedFocusSearchInput(preserveCursor = true) {
            if (searchInput) {
                searchInput.focus();
                
                if (preserveCursor && lastInputValue === searchInput.value) {
                    // 如果内容没有变化，恢复到之前的光标位置
                    setCursorPosition(searchInput, lastCursorPosition);
                } else {
                    // 如果内容发生变化，将光标设置到最后
                    const length = searchInput.value.length;
                    setCursorPosition(searchInput, length);
                    lastCursorPosition = length;
                }
                
                lastInputValue = searchInput.value;
            }
        }
        
        // 智能搜索框定位函数 - 不仅定位到搜索框，还保持光标位置
        function smartFocusSearchInput() {
            // 记录当前输入框的状态
            if (searchInput) {
                lastCursorPosition = getCursorPosition(searchInput);
                lastInputValue = searchInput.value;
                
                // 执行增强的焦点设置
                enhancedFocusSearchInput(true);
                
                // 滚动到搜索框位置
                searchInput.scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'center' 
                });
            }
        }
        
        // 增强的历史记录点击处理
        function enhancedHistoryItemClick(keyword) {
            // 将关键词填入搜索框
            if (searchInput) {
                searchInput.value = keyword;
                // 设置光标到最后一个字符
                const position = keyword.length;
                setCursorPosition(searchInput, position);
                lastCursorPosition = position;
                lastInputValue = keyword;
            }
        }
        
        // 位置记忆变量 - 用于 Tab/Ctrl+Tab 跳转
        let lastButtonPosition = null;  // 上次在按钮区域的位置
        let lastHistoryPosition = null; // 上次在历史区域的位置

        // 错误提示模态框函数
        function showErrorModal() {
            const modal = document.getElementById('error-modal');
            if (modal) {
                modal.style.display = 'flex';
                
                // 点击模态框外部关闭
                const handleModalClick = function(e) {
                    if (e.target === modal) {
                        modal.style.display = 'none';
                        modal.removeEventListener('click', handleModalClick);
                    }
                };
                modal.addEventListener('click', handleModalClick);
                
                // ESC键关闭
                const handleEscapeKey = function(e) {
                    if (e.key === 'Escape') {
                        modal.style.display = 'none';
                        document.removeEventListener('keydown', handleEscapeKey);
                        modal.removeEventListener('click', handleModalClick);
                    }
                };
                document.addEventListener('keydown', handleEscapeKey);
                
                // 3秒后自动关闭
                setTimeout(() => {
                    modal.style.display = 'none';
                    document.removeEventListener('keydown', handleEscapeKey);
                    modal.removeEventListener('click', handleModalClick);
                }, 3000);
            }
        }

        // 动态添加设置按钮
        const settingsBtn = document.createElement('button');
        settingsBtn.id = 'settings';
        settingsBtn.textContent = '设置';
        document.querySelector('.control-buttons').appendChild(settingsBtn);

        const blockingRuleControls = document.createElement('span');
        blockingRuleControls.className = 'blocking-rule-inline-controls';
        blockingRuleControls.setAttribute('aria-label', '添加阻断规则');
        blockingRuleControls.innerHTML = `
            <label>
                <input type="radio" name="blocking-rule-scope" value="keyword" checked>
                仅关键词
            </label>
            <label>
                <input type="radio" name="blocking-rule-scope" value="url">
                仅 URL
            </label>
            <label>
                <input type="radio" name="blocking-rule-scope" value="both">
                关键词和 URL
            </label>
            <button id="add-blocking-rule" type="button">添加阻断规则</button>
            <span id="blocking-rule-status" role="status" aria-live="polite"></span>
        `;
        if (typeof settingsBtn.insertAdjacentElement === 'function') {
            settingsBtn.insertAdjacentElement('afterend', blockingRuleControls);
        } else {
            document.querySelector('.control-buttons')
                .appendChild(blockingRuleControls);
        }

        const addBlockingRuleBtn =
            blockingRuleControls.querySelector('#add-blocking-rule');
        const blockingRuleStatus =
            blockingRuleControls.querySelector('#blocking-rule-status');

        const blockingRulesApi = globalThis.MySearchBlockingRules;
        function sendBlockingRuleMessage(value, scope) {
            return new Promise((resolve, reject) => {
                let settled = false;
                const timeout = setTimeout(() => {
                    if (settled) return;
                    settled = true;
                    reject(new Error('插件响应超时'));
                }, 5000);

                try {
                    chrome.runtime.sendMessage({
                        type: 'ADD_BLOCKING_RULE',
                        value,
                        scope,
                    }, response => {
                        if (settled) return;
                        settled = true;
                        clearTimeout(timeout);

                        const runtimeError = chrome.runtime.lastError;
                        if (runtimeError) {
                            reject(new Error(runtimeError.message));
                            return;
                        }
                        if (!response?.success) {
                            if (
                                blockingRulesApi
                                    ?.isUnknownAddRuleResponse(response)
                            ) {
                                void blockingRulesApi
                                    .addRuleToStorage(value, scope)
                                    .then(rules => {
                                        resolve({
                                            success: true,
                                            rules,
                                        });
                                    })
                                    .catch(reject);
                                return;
                            }
                            reject(new Error(
                                response?.error || '阻断规则保存失败'
                            ));
                            return;
                        }
                        resolve(response);
                    });
                } catch (error) {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timeout);
                    reject(error);
                }
            });
        }

        addBlockingRuleBtn?.addEventListener('click', async () => {
            const value = searchInput.value.trim();
            const selectedScope = blockingRuleControls.querySelector(
                'input[name="blocking-rule-scope"]:checked'
            );
            const scope = selectedScope?.value;

            if (!value) {
                blockingRuleStatus.dataset.state = 'error';
                blockingRuleStatus.textContent = '请先输入规则内容';
                searchInput.focus();
                return;
            }

            if (!['keyword', 'url', 'both'].includes(scope)) {
                blockingRuleStatus.dataset.state = 'error';
                blockingRuleStatus.textContent = '规则类型无效';
                return;
            }

            addBlockingRuleBtn.disabled = true;
            blockingRuleStatus.dataset.state = '';
            blockingRuleStatus.textContent = '正在添加…';
            try {
                await sendBlockingRuleMessage(value, scope);
                blockingRuleStatus.textContent = '规则已添加';
            } catch (error) {
                blockingRuleStatus.dataset.state = 'error';
                blockingRuleStatus.textContent =
                    error?.message || '阻断规则保存失败';
            } finally {
                addBlockingRuleBtn.disabled = false;
            }
        });

        settingsBtn.addEventListener('click', () => {
            chrome.runtime.openOptionsPage();
        });

        // 编辑状态标志
        let isEditMode = false;
        let isEditingHistory = false;
        let currentEditItem = null;
        let isInputMethodActive = false;

        // 快速搜索相关变量
        let quickSearchKeys = '';
        let matchedItems = [];
        let currentMatchIndex = -1;

        // 更新快速搜索显示状态
        function updateQuickSearchDisplay() {
            if (quicksearchinput) {
                quicksearchinput.value = quickSearchKeys;
                // 直接设置光标位置到用户输入的最后字符
                const position = quickSearchKeys.length;
                quicksearchinput.setSelectionRange(position, position);
                console.log(`更新快速搜索显示，光标定位：${position}/${quickSearchKeys.length}`);
            }
        }

        // 执行快速搜索匹配
        function performQuickSearch() {
            if (!quickSearchKeys) {
                clearMatches();
                showAllHistoryItems();
                return;
            }

            quickSearchActive = true;
            matchedItems = [];
            
            // 搜索按钮
            document.querySelectorAll('button[data-site]').forEach(button => {
                const buttonText = button.textContent.toLowerCase();
                const query = quickSearchKeys.toLowerCase();
                
                // 检查直接包含
                const directMatch = buttonText.includes(query);
                
                // 检查拼音首字母匹配
                const pinyinMatch = checkPinyinMatch(button.textContent, quickSearchKeys);
                
                if (directMatch || pinyinMatch) {
                    button.classList.add('highlight');
                    matchedItems.push({
                        element: button,
                        type: 'button',
                        text: button.textContent
                    });
                } else {
                    button.classList.remove('highlight');
                }
            });

            // 搜索历史记录
            document.querySelectorAll('.history-item').forEach(item => {
                const itemText = item.textContent.toLowerCase();
                const query = quickSearchKeys.toLowerCase();
                
                // 检查直接包含
                const directMatch = itemText.includes(query);
                
                // 检查拼音首字母匹配
                const pinyinMatch = checkPinyinMatch(item.textContent, quickSearchKeys);
                
                if (directMatch || pinyinMatch) {
                    item.classList.add('highlight');
                    item.style.display = '';
                    matchedItems.push({
                        element: item,
                        type: 'history',
                        text: item.textContent
                    });
                } else {
                    item.classList.remove('highlight');
                    item.style.display = 'none';
                }
            });

            // 设置第一个匹配项为当前项
            if (matchedItems.length > 0) {
                currentMatchIndex = 0;
                highlightCurrentMatch();
                currentFocusElement = matchedItems[0].element;
            } else {
                currentMatchIndex = -1;
            }
        }

        // 显示所有历史记录项
        function showAllHistoryItems() {
            document.querySelectorAll('.history-item').forEach(item => {
                item.style.display = '';
                item.classList.remove('highlight');
            });
            document.querySelectorAll('button[data-site]').forEach(button => {
                button.classList.remove('highlight');
            });
        }

        // 检查拼音匹配
        function checkPinyinMatch(text, query) {
            try {
                const pinyinArray = getPinyinInitials(text);
                const combinations = generatePinyinCombinations(pinyinArray);
                const queryLower = query.toLowerCase();
                
                return combinations.some(combo => 
                    combo.toLowerCase().includes(queryLower)
                );
            } catch (error) {
                return false;
            }
        }

        // 生成拼音首字母组合
        function generatePinyinCombinations(arrays) {
            if (!arrays || arrays.length === 0) return [''];
            const [first, ...rest] = arrays;
            const restCombinations = generatePinyinCombinations(rest);
            const results = [];
            for (let i = 0; i < first.length; i++) {
                for (let j = 0; j < restCombinations.length; j++) {
                    results.push(first[i] + restCombinations[j]);
                }
            }
            return results;
        }

        // 表格列宽调整功能
        let isResizing = false;
        let currentResizer = null;
        let currentColumnIndex = -1;
        let startX = 0;
        let startWidth = 0;
        let startNextWidth = 0;

        function initializeColumnResizing() {
            const table = document.getElementById('sites-table');
            const colgroup = document.getElementById('sites-table-colgroup');
            
            if (!table || !colgroup) return;

            // 为每个调整器添加事件监听
            const resizers = table.querySelectorAll('.column-resizer');
            
            resizers.forEach((resizer, index) => {
                resizer.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    isResizing = true;
                    currentResizer = resizer;
                    currentColumnIndex = index;
                    startX = e.clientX;
                    
                    // 获取当前列和下一列的宽度
                    const cols = colgroup.querySelectorAll('col');
                    const currentCol = cols[index];
                    const nextCol = cols[index + 1];
                    
                    if (currentCol && nextCol) {
                        startWidth = currentCol.getBoundingClientRect().width;
                        startNextWidth = nextCol.getBoundingClientRect().width;
                    }
                    
                    // 添加样式
                    resizer.classList.add('resizing');
                    document.body.classList.add('table-resizing');
                    
                    // 阻止文本选择
                    document.body.style.userSelect = 'none';
                    
                    console.log(`开始调整列 ${index}，初始宽度：${startWidth}px`);
                });
            });

            // 全局鼠标移动事件
            document.addEventListener('mousemove', (e) => {
                if (!isResizing || !currentResizer) return;
                
                e.preventDefault();
                
                const deltaX = e.clientX - startX;
                const cols = colgroup.querySelectorAll('col');
                const currentCol = cols[currentColumnIndex];
                const nextCol = cols[currentColumnIndex + 1];
                
                if (currentCol && nextCol) {
                    const tableWidth = table.getBoundingClientRect().width;
                    
                    // 计算新的宽度（百分比）
                    const newCurrentWidth = Math.max(50, startWidth + deltaX); // 最小50px
                    const newNextWidth = Math.max(50, startNextWidth - deltaX); // 最小50px
                    
                    // 转换为百分比
                    const currentPercent = (newCurrentWidth / tableWidth) * 100;
                    const nextPercent = (newNextWidth / tableWidth) * 100;
                    
                    // 应用新宽度
                    currentCol.style.width = `${currentPercent}%`;
                    nextCol.style.width = `${nextPercent}%`;
                    
                    console.log(`调整中：列${currentColumnIndex} = ${currentPercent.toFixed(1)}%, 列${currentColumnIndex + 1} = ${nextPercent.toFixed(1)}%`);
                }
            });

            // 全局鼠标释放事件
            document.addEventListener('mouseup', () => {
                if (!isResizing) return;
                
                isResizing = false;
                
                if (currentResizer) {
                    currentResizer.classList.remove('resizing');
                    currentResizer = null;
                }
                
                document.body.classList.remove('table-resizing');
                document.body.style.userSelect = '';
                
                currentColumnIndex = -1;
                startX = 0;
                startWidth = 0;
                startNextWidth = 0;
                
                console.log('列宽调整完成');
                
                // 保存列宽设置到localStorage
                saveColumnWidths();
            });
        }

        // 保存列宽设置
        function saveColumnWidths() {
            const colgroup = document.getElementById('sites-table-colgroup');
            if (!colgroup) return;
            
            const cols = colgroup.querySelectorAll('col');
            const widths = Array.from(cols).map(col => col.style.width);
            
            try {
                localStorage.setItem('tableColumnWidths', JSON.stringify(widths));
                console.log('列宽设置已保存:', widths);
            } catch (e) {
                console.warn('保存列宽设置失败:', e);
            }
        }

        // 加载列宽设置
        function loadColumnWidths() {
            try {
                const savedWidths = localStorage.getItem('tableColumnWidths');
                if (savedWidths) {
                    const widths = JSON.parse(savedWidths);
                    const colgroup = document.getElementById('sites-table-colgroup');
                    
                    if (colgroup && widths.length > 0) {
                        const cols = colgroup.querySelectorAll('col');
                        widths.forEach((width, index) => {
                            if (cols[index] && width) {
                                cols[index].style.width = width;
                            }
                        });
                        console.log('列宽设置已加载:', widths);
                    }
                }
            } catch (e) {
                console.warn('加载列宽设置失败:', e);
            }
        }

        // 判断设置模态框是否打开
        function isSettingsModalOpen() {
            return !!(settingsModal && settingsModal.style.display && settingsModal.style.display !== 'none');
        }

        // 设置模态框 ESC 三段式逻辑状态
        // 0: 初始/已关闭 -> 第一次ESC：失焦
        // 1: 已失焦 -> 第二次ESC：若有隐藏的行则清除过滤并显示全部，否则直接进入阶段2
        // 2: 清空过滤/无隐藏 -> 第三次ESC：关闭模态
        let settingsEscStage = 0;

        function openSettingsModal() {
            if (!settingsModal) return;
            settingsModal.style.display = 'flex';
            settingsEscStage = 0; // 重置为第一阶段
            document.body.classList.add('modal-open');
            // 打开时刷新表格并应用当前过滤
            if (typeof populateSettingsTable === 'function') {
                populateSettingsTable();
            }
            if (settingsSearchInput) {
                filterSettingsTable(settingsSearchInput.value || '');
            }
            // 初始化列宽调整功能
            setTimeout(() => {
                loadColumnWidths();
                initializeColumnResizing();
            }, 100);
            if (settingsSearchInput) {
                settingsSearchInput.focus();
            }
        }

        function closeSettingsModal() {
            if (!settingsModal) return;
            settingsModal.style.display = 'none';
            settingsEscStage = 0; // 复位阶段
            document.body.classList.remove('modal-open');
        }

        function handleSettingsModalEscape(e) {
            e.preventDefault();
            e.stopPropagation();

            const active = document.activeElement;

            // 1. 如果有元素聚焦，则失焦到模态框本身，而不是body
            if (active && settingsModal.contains(active) && active !== settingsModal) {
                settingsModal.focus(); // 聚焦到模态框容器
                return;
            }

            // 2. 如果没有元素聚焦，但有隐藏的行，则清空筛选
            const rows = Array.from(document.querySelectorAll('#sites-table-body tr'));
            const hasHidden = rows.some(r => r.style.display === 'none');
            if (hasHidden) {
                if (settingsSearchInput) {
                    settingsSearchInput.value = '';
                    filterSettingsTable('');
                }
                return;
            }

            // 3. 如果既没有聚焦的元素，也没有隐藏的行，则关闭模态框
            closeSettingsModal();
        }

        // 点击遮罩关闭模态框，并重置ESC阶段
        if (settingsModal) {
            settingsModal.addEventListener('click', function(e) {
                if (e.target === settingsModal) {
                    closeSettingsModal();
                }
            });

            // 捕获按键，确保ESC在模态框内两段式生效
            settingsModal.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') {
                    handleSettingsModalEscape(e);
                    return;
                }

                // F8 清空并聚焦设置搜索框
                if (e.key === 'F8') {
                    e.preventDefault();
                    if (settingsSearchInput) {
                        settingsSearchInput.value = '';
                        settingsSearchInput.focus();
                        filterSettingsTable('');
                    }
                    return;
                }

                // 线性可聚焦元素（动作按钮 + 搜索网站 + 表格输入/按钮）
                const focusableSelectors = '#settings-actions button, #settings-search, #sites-table input, #sites-table button';
                const focusables = Array.from(settingsModal.querySelectorAll(focusableSelectors));
                const currentIndex = focusables.indexOf(document.activeElement);

                // 左右键：输入框内优先移动光标；当光标到达边界时在同一行水平换列
                if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                    const isTextInput = e.target && e.target.matches('input[type="text"], input:not([type]), textarea, input[type="search"], input[type="url"], input[type="number"], input[type="email"], input[type="password"]');
                    e.stopPropagation(); // 避免全局处理器同时介入

                    const moveHorizontally = (direction) => {
                        const currentRow = e.target.closest('tr');
                        if (!currentRow) return;
                        const isVisible = (el) => el && el.offsetParent !== null && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' && !el.disabled;
                        const cells = Array.from(currentRow.querySelectorAll('td'));
                        const getCellFocusable = (td) => Array.from(td.querySelectorAll('input, button')).find(isVisible);
                        const rowFocusables = cells.map(getCellFocusable).filter(Boolean);
                        const currentEl = e.target.closest('input, button') || e.target;
                        let colIndex = rowFocusables.findIndex(el => el === currentEl);
                        if (colIndex < 0) {
                            const currentCell = currentEl.closest('td');
                            colIndex = Math.max(0, cells.indexOf(currentCell));
                        }
                        const nextIndex = Math.max(0, Math.min(rowFocusables.length - 1, colIndex + direction));
                        if (nextIndex !== colIndex && rowFocusables[nextIndex]) {
                            const target = rowFocusables[nextIndex];
                            target.focus();
                            if (target.matches('input')) {
                                // 左移到上一列 -> 光标置末尾；右移到下一列 -> 光标置开头
                                const pos = direction < 0 ? (target.value ? target.value.length : 0) : 0;
                                try { target.setSelectionRange(pos, pos); } catch (_) {}
                            }
                        }
                    };

                    if (isTextInput) {
                        const input = e.target;
                        const start = input.selectionStart;
                        const end = input.selectionEnd;
                        const len = (typeof input.value === 'string') ? input.value.length : 0;
                        // 在边界并且没有选区时，进行跨列跳转
                        if (e.key === 'ArrowLeft' && start === end && start === 0) {
                            e.preventDefault();
                            moveHorizontally(-1);
                            return;
                        }
                        if (e.key === 'ArrowRight' && start === end && end === len) {
                            e.preventDefault();
                            moveHorizontally(1);
                            return;
                        }
                        // 其他情况交给浏览器默认的光标移动
                        return;
                    } else {
                        // 非输入元素时，左右默认不引发页面水平滚动
                        e.preventDefault();
                        return;
                    }
                }

                // 上下键：在表格中按列跨行移动；按钮/搜索网站也参与逻辑
                if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                    e.preventDefault();
                    e.stopPropagation();

                    const table = settingsModal.querySelector('#sites-table');
                    const actionsBar = settingsModal.querySelector('#settings-actions');
                    const isInTable = !!(table && e.target && table.contains(e.target));
                    const isSearch = e.target && e.target.id === 'settings-search';
                    const isActionsButton = e.target && actionsBar && actionsBar.contains(e.target) && e.target.tagName === 'BUTTON';

                    // 搜索网站：Down -> 首行第一列；Up -> 动作栏最后一个按钮
                    if (isSearch) {
                        if (e.key === 'ArrowDown') {
                            const firstRow = Array.from(settingsModal.querySelectorAll('#sites-table-body tr')).find(r => (r.offsetParent !== null) && getComputedStyle(r).display !== 'none');
                            if (firstRow) {
                                const firstFocusable = firstRow.querySelector('input, button');
                                if (firstFocusable) firstFocusable.focus();
                            }
                        } else {
                            const actionButtons = actionsBar ? Array.from(actionsBar.querySelectorAll('button')) : [];
                            if (actionButtons.length > 0) actionButtons[actionButtons.length - 1].focus();
                        }
                        return;
                    }

                    // 动作栏按钮：Down -> 首行第一列；Up -> 搜索网站
                    if (isActionsButton) {
                        if (e.key === 'ArrowDown') {
                            const firstRow = Array.from(settingsModal.querySelectorAll('#sites-table-body tr')).find(r => (r.offsetParent !== null) && getComputedStyle(r).display !== 'none');
                            if (firstRow) {
                                const firstFocusable = firstRow.querySelector('input, button');
                                if (firstFocusable) firstFocusable.focus();
                            }
                        } else if (settingsSearchInput) {
                            settingsSearchInput.focus();
                        }
                        return;
                    }

                    // 表格内：按列跨行（输入与按钮均支持）
                    if (isInTable) {
                        const currentRow = e.target.closest('tr');
                        if (currentRow) {
                            const allVisibleRows = Array.from(settingsModal.querySelectorAll('#sites-table-body tr')).filter(r => (r.offsetParent !== null) && getComputedStyle(r).display !== 'none');
                            const rowIndex = allVisibleRows.indexOf(currentRow);
                            if (rowIndex !== -1) {
                                const isVisible = (el) => el && el.offsetParent !== null && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' && !el.disabled;
                                const currentCell = e.target.closest('td');
                                const currentCells = Array.from(currentRow.querySelectorAll('td'));
                                let cellIndex = Math.max(0, currentCells.indexOf(currentCell));

                                const direction = (e.key === 'ArrowDown') ? 1 : -1;
                                const nextRowIndex = Math.max(0, Math.min(allVisibleRows.length - 1, rowIndex + direction));

                                // 顶部越界：上移到动作栏最后一个按钮（若有），否则搜索框
                                if (nextRowIndex === rowIndex && direction < 0 && rowIndex === 0) {
                                    const actionButtons = actionsBar ? Array.from(actionsBar.querySelectorAll('button')) : [];
                                    if (actionButtons.length > 0) {
                                        actionButtons[actionButtons.length - 1].focus();
                                    } else if (settingsSearchInput) {
                                        settingsSearchInput.focus();
                                    }
                                    return;
                                }

                                if (nextRowIndex !== rowIndex) {
                                    const targetRow = allVisibleRows[nextRowIndex];
                                    const targetCells = Array.from(targetRow.querySelectorAll('td'));
                                    // 优先同列
                                    let targetCell = targetCells[cellIndex];
                                    let targetEl = targetCell ? Array.from(targetCell.querySelectorAll('input, button')).find(isVisible) : null;
                                    // 若同列无可聚焦，向右再向左寻找最近的可聚焦
                                    if (!targetEl) {
                                        // 向右
                                        for (let i = cellIndex + 1; i < targetCells.length; i++) {
                                            const cand = Array.from(targetCells[i].querySelectorAll('input, button')).find(isVisible);
                                            if (cand) { targetEl = cand; break; }
                                        }
                                    }
                                    if (!targetEl) {
                                        // 向左
                                        for (let i = cellIndex - 1; i >= 0; i--) {
                                            const cand = Array.from(targetCells[i].querySelectorAll('input, button')).find(isVisible);
                                            if (cand) { targetEl = cand; break; }
                                        }
                                    }
                                    if (targetEl) targetEl.focus();
                                    return;
                                }
                            }
                        }
                        // 未找到匹配时，回退到线性移动
                    }

                    if (currentIndex !== -1) {
                        let nextIndex = currentIndex + (e.key === 'ArrowDown' ? 1 : -1);
                        nextIndex = Math.max(0, Math.min(focusables.length - 1, nextIndex));
                        focusables[nextIndex].focus();
                    } else if (focusables.length > 0) {
                        focusables[0].focus();
                    }
                    return;
                }

                // 使用 Tab/Shift+Tab 实现线性导航（替代左右键）
                if (e.key === 'Tab') {
                    e.preventDefault();
                    e.stopPropagation();
                    if (currentIndex !== -1) {
                        let nextIndex = currentIndex + (e.shiftKey ? -1 : 1);
                        nextIndex = Math.max(0, Math.min(focusables.length - 1, nextIndex));
                        focusables[nextIndex].focus();
                    } else if (focusables.length > 0) {
                        focusables[0].focus();
                    }
                    return;
                }
            }, true);

            // 注意：不在 focusin 时重置阶段，避免首个 ESC 失焦后立即被重置导致无法进入第二阶段
        }

        // 设置模态框内拼音首字母筛选（适配所有字段）
        function textMatchesWithPinyin(text, query) {
            if (!query) return true;
            const lower = (text || '').toLowerCase();
            if (lower.indexOf(query) !== -1) return true;

            // 生成拼音首字母组合并匹配
            function generatePinyinCombinations(arrays) {
                if (!arrays || arrays.length === 0) return [''];
                const [first, ...rest] = arrays;
                const restCombinations = generatePinyinCombinations(rest);
                const results = [];
                for (let i = 0; i < first.length; i++) {
                    for (let j = 0; j < restCombinations.length; j++) {
                        results.push(first[i] + restCombinations[j]);
                    }
                }
                return results;
            }

            const pinyinArray = getPinyinInitials(text || '');
            const combos = generatePinyinCombinations(pinyinArray).map(c => (c || '').toLowerCase());
            return combos.some(c => c.indexOf(query) !== -1);
        }

        function filterSettingsTable(keyword) {
            const queries = (keyword || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
            const rows = document.querySelectorAll('#sites-table-body tr');
            rows.forEach(row => {
                const cells = Array.from(row.querySelectorAll('td'));
                const fields = cells.map(td => {
                    const input = td.querySelector('input');
                    return input ? input.value : td.textContent;
                });

                const matchesAll = queries.every(q => {
                    return fields.some(text => textMatchesWithPinyin(text, q));
                });

                row.style.display = matchesAll ? '' : 'none';
            });
        }

        if (settingsSearchInput) {
            settingsSearchInput.addEventListener('input', function() {
                filterSettingsTable(this.value);
            });
        }

        // 排序状态对象
        const sortStates = {
            name: { ascending: true },
            time: { ascending: false }, // 时间默认倒序（新->旧）
            length: { ascending: true }, // 长度默认升序
            firstTime: { ascending: false }, // 首次搜索时间默认倒序（新->旧）
            count: { ascending: false } // 搜索次数默认倒序（多->少）
        };

        // 排序功能（支持双向）
        function sortByName() {
            const state = sortStates.name;
            state.ascending = !state.ascending; // 切换方向

            searchHistory.sort((a, b) =>
                state.ascending ? a.keyword.localeCompare(b.keyword) : b.keyword.localeCompare(a.keyword)
            );

            // 更新按钮文本
            document.getElementById('sort-by-name').textContent =
                `名称 ${state.ascending ? '↑' : '↓'}`;

            renderHistory();
        }

        function sortByTime() {
            const state = sortStates.time;
            state.ascending = !state.ascending; // 切换方向

            // 根据最新时间戳排序
            searchHistory.sort((a, b) => {
                const timeA = new Date(a.latest_timestamp).getTime();
                const timeB = new Date(b.latest_timestamp).getTime();
                return state.ascending ? timeA - timeB : timeB - timeA;
            });

            // 更新按钮文本
            document.getElementById('sort-by-time').textContent =
                `时间 ${state.ascending ? '↑' : '↓'}`;

            renderHistory();
        }

        function sortByLength() {
            const state = sortStates.length;
            state.ascending = !state.ascending; // 切换方向

            searchHistory.sort((a, b) =>
                state.ascending ? a.keyword.length - b.keyword.length : b.keyword.length - a.keyword.length
            );

            // 更新按钮文本
            document.getElementById('sort-by-length').textContent =
                `长度 ${state.ascending ? '↑' : '↓'}`;

            renderHistory();
        }

        function sortByFirstTime() {
            const state = sortStates.firstTime;
            state.ascending = !state.ascending; // 切换方向

            // 根据首次搜索时间排序
            searchHistory.sort((a, b) => {
                const timeA = new Date(a.first_timestamp).getTime();
                const timeB = new Date(b.first_timestamp).getTime();
                return state.ascending ? timeA - timeB : timeB - timeA;
            });

            // 更新按钮文本
            document.getElementById('sort-by-first-time').textContent =
                `首次 ${state.ascending ? '↑' : '↓'}`;

            renderHistory();
        }

        function sortByCount() {
            const state = sortStates.count;
            state.ascending = !state.ascending; // 切换方向

            // 根据搜索次数排序
            searchHistory.sort((a, b) =>
                state.ascending ? a.search_count - b.search_count : b.search_count - a.search_count
            );

            // 更新按钮文本
            document.getElementById('sort-by-count').textContent =
                `次数 ${state.ascending ? '↑' : '↓'}`;

            renderHistory();
        }

        // 加载搜索历史（使用IndexedDB）        
        async function loadSearchHistory() {
            try {
                searchHistory = await historyPersistence.load();
                renderHistory();
            } catch (error) {
                console.error('加载历史记录失败，回退到localStorage:', error);
                loadHistoryFromLocalStorage();
            }
        }
        
        // 回退到localStorage的加载方法
        function loadHistoryFromLocalStorage() {
            console.log('使用localStorage加载历史记录...');
            const storedHistory = localStorage.getItem('searchHistory');
            if (storedHistory) {
                try {
                    const parsed = JSON.parse(storedHistory);
                    if (Array.isArray(parsed)) {
                        searchHistory = parsed.map(item => {
                            if (typeof item === 'string') {
                                return {
                                    keyword: item,
                                    first_timestamp: new Date().toISOString(),
                                    search_count: 1,
                                    latest_timestamp: new Date().toISOString()
                                };
                            }
                            return item;
                        });
                        console.log('从localStorage加载的历史记录:', searchHistory);
                        renderHistory();
                        return;
                    }
                } catch (e) {
                    console.error('解析localStorage历史记录失败:', e);
                }
            }
            console.log('localStorage中没有历史记录');
            searchHistory = [];
            renderHistory();
        }
        

        // 添加历史记录函数（使用IndexedDB）
        async function addToHistory(keyword) {
            if (!keyword || keyword.trim() === '') return;
            
            try {
                searchHistory = await historyPersistence.add(keyword.trim());
                renderHistory();
            } catch (error) {
                console.error('添加历史记录失败:', error);
            }
        }

        // 删除历史记录函数（使用IndexedDB）
        async function removeFromHistory(keyword) {
            try {
                searchHistory = await historyPersistence.remove(keyword);
                renderHistory();
            } catch (error) {
                console.error('删除历史记录失败:', error);
            }
        }

        // 排序按钮事件
        document.getElementById('sort-by-name').addEventListener('click', sortByName);
        document.getElementById('sort-by-time').addEventListener('click', sortByTime);
        document.getElementById('sort-by-length').addEventListener('click', sortByLength);
        document.getElementById('sort-by-first-time').addEventListener('click', sortByFirstTime);
        document.getElementById('sort-by-count').addEventListener('click', sortByCount);

        // 主搜索框输入处理函数
        function handleInput(e) {
            // 更新光标位置记录
            lastInputValue = searchInput.value;
            lastCursorPosition = getCursorPosition(searchInput);
            
            // 如果输入框为空，清除所有快速搜索状态
            if (!searchInput.value.trim()) {
                clearQuickSearchState();
            }
        }

        // 全局键盘事件（用于快速搜索）
        document.addEventListener('keydown', handleGlobalKeyDown);

        // 输入框事件
        searchInput.addEventListener('input', handleInput);

        searchInput.addEventListener('focus', () => {
            currentFocusElement = searchInput;
            quickSearchActive = false;
        });

        // 清空输入框按钮
        // 修改清空按钮事件监听器
        clearInputBtn.addEventListener('click', () => {
            // 清空主搜索框
            searchInput.value = '';
            searchInput.focus();

        });
        saveOnlyBtn.addEventListener('click', () => {
            const keyword = searchInput.value.trim();
            if (keyword) {
                addToHistory(keyword);
                searchInput.value = '';
            }
        });
        editHistoryBtn.addEventListener('click', (e) => {
            e.preventDefault(); // 新增
            e.stopPropagation();
            isEditMode = !isEditMode;
            editHistoryBtn.textContent = isEditMode ? '退出编辑' : '编辑历史';
            renderHistory();
        });
        exportHistoryBtn.addEventListener('click', (e) => {
            e.preventDefault(); // 新增
            e.stopPropagation(); // 新增
            exportHistory();
        });
        importHistoryBtn.addEventListener('click', (e) => {
            e.preventDefault(); // 新增
            e.stopPropagation(); // 新增
            importHistory();
        });

        // 批量搜索按钮
        allSitesBtn.addEventListener('click', () => batchSearch(getAllSites()));
        // 注意：由于移除了默认配置，常用和外网按钮暂时使用全部网站
        commonSitesBtn.addEventListener('click', () => batchSearch(getAllSites()));
        foreignSitesBtn.addEventListener('click', () => batchSearch(getAllSites()));
        // 为所有搜索按钮添加事件监听
        document.querySelectorAll('.btn-group button[data-site], .control-buttons button[data-site]').forEach(button => {
            button.addEventListener('click', (e) => {
                const site = button.getAttribute('data-site');
                if (e.button === 0) { // 左键点击
                    // 如果当前已经有选中的元素，则左键点击任何按钮都只做多选操作（切换选中状态）
                    if (selectedElements.length > 0) {
                        toggleSelectElement(button);
                    } else {
                        // 没有多选时，直接执行搜索
                        clearSelection();
                        search(site, true);
                    }
                }
            });

            // 右键点击多选
            button.addEventListener('contextmenu', (e) => {
                if (button.getAttribute('data-rightclick') !== 'true') return;
                e.preventDefault();
                toggleSelectElement(button);
            });

            button.addEventListener('focus', () => {
                if (!quickSearchActive) {
                    currentFocusElement = button;
                    quickSearchKeys = '';
                    updateQuickSearchDisplay();
                    clearMatches();
                }
                updatePositionMemory(); // 更新位置记忆
            });
        });

        // 单独处理编辑历史和导出历史按钮
        // 单独处理编辑历史和导出历史按钮

        // 保存编辑的历史记录（使用IndexedDB）
        // 编辑历史：使用 Enter 保存并关闭（移除保存按钮）
        if (historyEditInput) {
            historyEditInput.addEventListener('keydown', async (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (!currentEditItem) return;
                    const newVal = historyEditInput.value.trim();
                    if (!newVal) { editHistoryModal.style.display = 'none'; isEditingHistory = false; currentEditItem = null; return; }
                const oldKeyword = currentEditItem.getAttribute('data-keyword');
                    const newKeyword = newVal;
                if (oldKeyword !== newKeyword) {
                    try {
                        searchHistory = await historyPersistence.rename(oldKeyword, newKeyword);
                        renderHistory();
                    } catch (error) {
                        console.error('更新历史记录失败:', error);
                        alert('更新历史记录失败: ' + error.message);
                    }
                }
                editHistoryModal.style.display = 'none';
                isEditingHistory = false;
                currentEditItem = null;
            }
        });
        }

        // ESC键取消编辑
        historyEditInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                editHistoryModal.style.display = 'none';
                isEditingHistory = false;
                currentEditItem = null;
            }
        });


        document.addEventListener('click', (e) => {
            // 处理编辑模式
            if (isEditMode && !e.target.closest('.history-item') && e.target !== editHistoryBtn) {
                isEditMode = false;
                editHistoryBtn.textContent = '编辑历史';
                renderHistory();
            }

            // 关闭编辑模态框
            if (isEditingHistory && !e.target.closest('#edit-history-modal') && e.target !== editHistoryBtn) {
                editHistoryModal.style.display = 'none';
                isEditingHistory = false;
                currentEditItem = null;
            }

            // 点击空白处处理输入法
            if (!e.target.closest('button, input, .history-item')) {
                // 移动端处理
                if (screen.width <= 768) {
                    // 第一次点击：聚焦并弹出输入法
                    if (!isInputMethodActive) {
                        quicksearchinput.focus();
                        isInputMethodActive = true;
                    }
                    // 第二次点击：关闭输入法
                    else {
                        quicksearchinput.blur();
                        isInputMethodActive = false;
                    }
                }
                // 电脑端处理
                else {
                    if (document.activeElement === searchInput) { searchInput.blur(); }
                    if (document.activeElement === quicksearchinput) {
                        quickSearchKeys = '';
                        quickSearchActive = false;
                        quicksearchinput.blur();
                    }
                }
            }
        });
        // 5. 页面加载时自动聚焦
        window.addEventListener('DOMContentLoaded', function () { searchInput.focus(); });
        window.addEventListener('load', adjustScrollableArea);
        window.addEventListener('resize', adjustScrollableArea);

        // 初始化时立即聚焦
        focusQuickSearch();

        // 移动端快速搜索处理
        if (quicksearchinput) {
            quicksearchinput.addEventListener('input', focusQuickSearch)
            // 允许空格输入
            quicksearchinput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') {
                    // 只有聚焦到quicksearchinput时才执行历史项到搜索框的逻辑
                    if (document.activeElement === quicksearchinput) {
                        const firstMatch = document.querySelector('.highlight.history-item, .highlight[data-site]');
                        if (firstMatch && firstMatch.classList.contains('history-item')) {
                            // 使用增强的历史记录点击处理，将光标定位到最后字符
                            enhancedHistoryItemClick(firstMatch.textContent);
                        }
                    }
                }
            });
            // ESC按钮处理
            mobileEscBtn.addEventListener('click', function (e) {
                GlobalQuit(e);
            })
        }

        // 点击空白处退出编辑模式或关闭模态框
        function focusQuickSearch(e) {
            // 移动端处理：如果焦点不在输入框，先设置焦点
            if (screen.width <= 768 && document.activeElement !== quicksearchinput) {
                setTimeout(() => {
                    if (quicksearchinput) {
                        quicksearchinput.focus();
                        // 确保光标定位在最后输入字符位置
                        setTimeout(() => {
                            quicksearchinput.style.color = '';
                            const position = quicksearchinput.value.length;
                            quicksearchinput.setSelectionRange(position, position);
                            console.log(`移动端焦点设置，光标定位到：${position}`);
                        }, 100);
                    }
                }, 100);
                return;
            }
            
            // 执行快速搜索（适用于所有设备）
            quickSearchKeys = quicksearchinput.value;
            performQuickSearch();
            
            // 直接设置光标位置在用户输入的最后字符位置
            if (quicksearchinput && document.activeElement === quicksearchinput) {
                const position = quickSearchKeys.length;
                quicksearchinput.setSelectionRange(position, position);
                console.log(`快速搜索焦点，光标定位到：${position}`);
            }
        }

        // 清除所有匹配高亮
        function clearMatches() {
            matchedItems.forEach(item => {
                item.element.classList.remove('highlight');
            });
            matchedItems = [];
            currentMatchIndex = -1;
        }

        // 清理快速搜索状态和样式
        function clearQuickSearchState() {
            clearMatches();
            showAllHistoryItems();
            quickSearchActive = false;
            
            // 清除所有cursor-highlight样式
            document.querySelectorAll('.cursor-highlight').forEach(el => {
                el.classList.remove('cursor-highlight');
            });
            
            // 重置匹配索引
            currentMatchIndex = -1;
        }

        // 统一的光标管理函数 - 设置当前焦点并处理高亮
        function setCurrentFocus(element) {
            if (element) {
                element.focus();
                currentFocusElement = element;
                updatePositionMemory();
                
                // 如果不在quicksearch状态，清理cursor-highlight
                if (!quickSearchActive) {
                    document.querySelectorAll('.cursor-highlight').forEach(el => {
                        el.classList.remove('cursor-highlight');
                    });
                }
            }
        }

        // 全局键盘事件处理（快速搜索）
        function handleGlobalKeyDown(e) {
            // 设置模态框打开时，不触发主界面的全局退出和快捷键导航
            if (isSettingsModalOpen()) {
                // 模态框打开时的快捷键适配（ESC 在 modal 自身 keydown 捕获里处理，这里不再处理）

                const target = e.target;
                const isInModalInput = target && settingsModal && settingsModal.contains(target) && target.matches('input, textarea');

                // 在模态框打开时，允许像主界面quick search一样，直接键入触发搜索框过滤
                if (!isInModalInput && !e.ctrlKey && !e.altKey && !e.metaKey && e.key.length === 1 && /[a-zA-Z0-9!@#$%^&*()_+\-=`~\[\]{};':",.<>/?\\|]/.test(e.key)) {
                    if (settingsSearchInput) {
                        e.preventDefault();
                        settingsSearchInput.focus();
                        settingsSearchInput.value += e.key;
                        filterSettingsTable(settingsSearchInput.value);
                    }
                    return;
                }

                if (!isInModalInput && e.key === 'Backspace') {
                    if (settingsSearchInput) {
                        e.preventDefault();
                        settingsSearchInput.value = settingsSearchInput.value.slice(0, -1);
                        filterSettingsTable(settingsSearchInput.value);
                    }
                    return;
                }

                // F8 清空并聚焦设置搜索框
                if (e.key === 'F8') {
                    e.preventDefault();
                    if (settingsSearchInput) {
                        settingsSearchInput.value = '';
                        settingsSearchInput.focus();
                        filterSettingsTable('');
                    }
                    return;
                }

                // 方向键在动作按钮和表格输入之间导航（线性）
                if (["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(e.key)) {
                    const focusableSelectors = '#settings-actions button, #sites-table input';
                    const focusables = Array.from(settingsModal.querySelectorAll(focusableSelectors));
                    const currentIndex = focusables.indexOf(document.activeElement);
                    if (currentIndex !== -1) {
                        e.preventDefault();
                        let nextIndex = currentIndex;
                        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                            nextIndex = Math.min(focusables.length - 1, currentIndex + 1);
                        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                            nextIndex = Math.max(0, currentIndex - 1);
                        }
                        focusables[nextIndex].focus();
                    } else if (focusables.length > 0) {
                        e.preventDefault();
                        focusables[0].focus();
                    }
                    return;
                }

                // 其他按键在模态框打开时不传递到主界面
                return;
            }

            if (e.key === 'Escape') {
                GlobalQuit(e);
            }

            // 处理Ctrl+F3, Ctrl+F5, Ctrl+F6, Ctrl+F9, Ctrl+F10快捷键
            if (e.ctrlKey) {
                if (e.key === 'F3') {
                    e.preventDefault();
                    sortByName();
                    return;
                } else if (e.key === 'F5') {
                    e.preventDefault();
                    sortByTime();
                    return;
                } else if (e.key === 'F6') {
                    e.preventDefault();
                    sortByLength();
                    return;
                } else if (e.key === 'F9') {
                    e.preventDefault();
                    sortByFirstTime();
                    return;
                } else if (e.key === 'F10') {
                    e.preventDefault();
                    sortByCount();
                    return;
                }
            }
            // 电脑端快速搜索触发（字母、数字和标点符号，不包括空格和修饰键组合）
            if (window.screen.width > 768 && !document.activeElement.matches('input, textarea') && !isSettingsModalOpen() &&
                !e.ctrlKey && !e.altKey && !e.metaKey && // 排除修饰键组合，确保浏览器快捷键正常工作
                e.key.length === 1 && /[a-zA-Z0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(e.key)) {

                // 将输入的字符添加到快速搜索中
                e.preventDefault();
                quicksearchinput.focus();
                quicksearchinput.value += e.key;
                
                // 触发input事件来执行搜索
                quickSearchKeys = quicksearchinput.value;
                performQuickSearch();
                
                // 直接设置光标位置在用户输入的最后字符位置
                const position = quickSearchKeys.length;
                quicksearchinput.setSelectionRange(position, position);
                console.log(`全局键盘输入，光标定位到：${position}`);
                
                return;
            }
            // 电脑端快速搜索激活
            if (quickSearchActive && e.key === 'Backspace' && !isSettingsModalOpen()) {
                e.preventDefault();
                if (quickSearchKeys.length > 0) {
                    quickSearchKeys = quickSearchKeys.slice(0, -1);
                    updateQuickSearchDisplay();
                    if (quickSearchKeys) {
                        performQuickSearch();
                    } else {
                        // 清空输入但保持匹配状态，符合两次ESC逻辑
                        showAllHistoryItems();
                        // 保持quickSearchActive和matchedItems状态不变
                    }
                    
                    // 直接设置光标位置在剩余字符的最后位置
                    const position = quickSearchKeys.length;
                    quicksearchinput.setSelectionRange(position, position);
                    console.log(`Backspace处理，光标定位到：${position}`);
                }
                return;
            }

            // Tab/Ctrl+Tab 新逻辑：按钮和历史项之间的智能跳转
            if (e.key === 'Tab' && !isSettingsModalOpen()) {
                e.preventDefault();
                
                if (quickSearchActive && matchedItems.length > 0) {
                    // Quick search 状态下：仅在匹配项之间跳转
                    if (e.ctrlKey) {
                        // Ctrl+Tab: 在按钮区域和历史区域之间跳转
                        smartTabJump(true); // 反向跳转
                    } else {
                        // Tab: 在按钮区域和历史区域之间跳转
                        smartTabJump(false); // 正向跳转
                    }
                } else {
                    // 非 quick search 状态下：按钮和历史项之间跳转到上次位置
                    if (e.ctrlKey) {
                        // Ctrl+Tab: 反向跳转
                        smartTabJump(true);
                    } else {
                        // Tab: 正向跳转
                        smartTabJump(false);
                    }
                }
                return;
            }

            // 处理Ctrl+-取消所有选中
            if (e.key === '-' && e.ctrlKey) {
                e.preventDefault();
                e.stopPropagation();
                clearSelection();
                return;
            }

            if (isEditingHistory) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    saveEditBtn.click();
                    return;
                }

                return;
            }

            // F7聚焦输入框 - 使用增强的智能定位
            if (e.key === 'F7' && !isSettingsModalOpen()) {
                e.preventDefault();
                smartFocusSearchInput();
                return;
            }

            // 处理控制按钮的Enter键
            const controlButtons = ['save-only', 'all-sites', 'common-sites', 'foreign-sites',
                'edit-history', 'export-history', 'import-history',
                'sort-by-name', 'sort-by-time', 'sort-by-length', 'sort-by-first-time', 'sort-by-count',
                'export-ua-rules', 'mobile-esc-btn'];
            if (e.key === 'Enter' && currentFocusElement && controlButtons.includes(currentFocusElement.id) && !isSettingsModalOpen()) {
                e.preventDefault();
                currentFocusElement.click();
                return;
            }

            // 处理多选后的Enter键（优先处理多选）
            if (e.key === 'Enter' && selectedElements.length > 0) {
                e.preventDefault();
                // 直接传递选中的元素数组给batchSearch
                batchSearch(selectedElements);
                return;
            }

            // 方向键导航 - 新逻辑：区分 quick search 和非 quick search
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && !isSettingsModalOpen()) {
                // 如果焦点在输入框且是左右方向键，不阻止默认行为
                if (document.activeElement === searchInput && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
                    return;
                }

                e.preventDefault();

                // 快速搜索状态下：仅在匹配的项目上进行切换
                if (quickSearchActive && matchedItems.length > 0) {
                    // 如果是第一次按方向键，从第一个匹配项开始
                    if (currentMatchIndex === -1) {
                        currentMatchIndex = 0;
                        highlightCurrentMatch();
                    } else {
                        // 上下键：二维导航，找到上一行或下一行中最近的匹配项
                        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                            navigateVerticallyInMatches(e.key);
                        } 
                        // 左右键：在匹配项列表中线性移动
                        else if (e.key === 'ArrowRight') {
                            cycleMatches(1); // 下一个
                        } else if (e.key === 'ArrowLeft') {
                            cycleMatches(-1); // 上一个
                        }
                    }
                    // 更新位置记忆
                    updatePositionMemory();
                } else {
                    // 非 quick search 状态下：保持原有的逻辑
                    navigateWithArrowKeys(e.key);
                    // 更新位置记忆
                    updatePositionMemory();
                }
                return;
            }

            // 空格选择当前元素
            if (e.key === ' ' && !isSettingsModalOpen()) {
                // 如果焦点在主输入框，不处理空格选择（让输入框正常处理空格）
                if (document.activeElement === searchInput) {
                    return;
                }

                // 如果焦点在快速搜索框，让它正常处理空格作为搜索字符
                if (document.activeElement === quicksearchinput) {
                    return;
                }

                // 焦点不在快速搜索框时，空格键用于选中/取消选中当前元素
                e.preventDefault();
                
                if (currentFocusElement) {
                    // 处理按钮或历史项的选中/取消选中
                    if (currentFocusElement.tagName === 'BUTTON' || 
                        currentFocusElement.classList.contains('history-item')) {
                        toggleSelectElement(currentFocusElement);
                    }
                }
                return;
            }

            // Enter键执行操作
            if (e.key === 'Enter' && !isSettingsModalOpen()) {
                e.preventDefault();

                // 1. 处理快速搜索虚拟光标（最高优先级）
                if (quickSearchActive && matchedItems.length > 0) {
                    activateCurrentMatch();
                    return;
                }

                // 2. 处理多选网站的情况
                const selectedSites = selectedElements.filter(el => el.hasAttribute('data-site'));
                if (selectedSites.length > 0) {
                    batchSearch(selectedSites);
                    return;
                }

                // 3. 处理当前焦点在网站按钮上
                if (currentFocusElement && currentFocusElement.hasAttribute('data-site')) {
                    clearSelection(); // 清除所有选择
                    const site = currentFocusElement.getAttribute('data-site');
                    search(site, true); // 使用单个搜索函数
                    return;
                }

                // 4. 处理历史项
                if (currentFocusElement && currentFocusElement.classList.contains('history-item')) {
                    const keyword = currentFocusElement.getAttribute('data-keyword');
                    searchInput.value = keyword;
                    searchInput.focus();
                    return;
                }
            }

            // F2编辑历史记录
            if (e.key === 'F2' && currentFocusElement && currentFocusElement.classList.contains('history-item') && !isSettingsModalOpen()) {
                e.preventDefault();
                const keyword = currentFocusElement.getAttribute('data-keyword');
                editHistoryItem(keyword);
                return;
            }

            // Delete删除历史记录：支持删除选中项或当前焦点项
            if (e.key === 'Delete' && !isSettingsModalOpen()) {
                // 如果有选中项，删除选中项
                if (selectedElements.length > 0) {
                    e.preventDefault();
                    deleteSelectedHistoryItems();
                    return;
                }
                // 如果当前焦点是历史记录项，删除该焦点项
                else if (currentFocusElement && currentFocusElement.classList.contains('history-item')) {
                    e.preventDefault();
                    // 临时选中当前焦点项
                    const prevSelected = selectedElements;
                    selectedElements = [currentFocusElement];
                    deleteSelectedHistoryItems();
                    // 恢复之前的选中状态
                    selectedElements = prevSelected;
                    return;
                }
            }

            if (e.key === 'F8' && !isSettingsModalOpen()) {
                e.preventDefault();
                openExtensionOptions();
                return;
            }

            if (e.ctrlKey && e.key === 'Delete' && !isSettingsModalOpen()) {
                e.preventDefault();
                searchInput.value = '';
                searchInput.focus();
                return;
            }

            // Ctrl+Z撤销删除
            if (e.key === 'z' && e.ctrlKey && lastDeletedItems.length > 0 && !isSettingsModalOpen()) {
                e.preventDefault();
                undoDelete();
                return;
            }
        }

        function GlobalQuit(e) {
            // e.preventDefault();
            if (isEditMode) {
                e.preventDefault();
                isEditMode = false;
                if (typeof editHistoryBtn !== 'undefined' && editHistoryBtn) {
                    editHistoryBtn.textContent = '编辑历史';
                }
                editHistoryModal.style.display = 'none';
                isEditingHistory = false;
                currentEditItem = null;
                if (typeof renderHistory === 'function') {
                    renderHistory();
                }
                return;
            }
            else if (document.activeElement === searchInput) {
                // e.preventDefault();
                searchInput.blur();
                return;
            }
            // 第一次ESC：失焦quick-search-input，但保持匹配项
            else if (quicksearchinput.value) {
                // e.preventDefault();
                quicksearchinput.value = '';
                quickSearchKeys = '';
                updateQuickSearchDisplay();
                quicksearchinput.blur();
                // 注意：这里不清理匹配项，保持quickSearchActive状态
                return;
            }
            // 第二次ESC：消除所有匹配项
            else if (!quicksearchinput.value && (quickSearchActive || matchedItems.length > 0)) {
                clearQuickSearchState();
                return;
            }
            return;
        }

        // 修改 updateQuickSearchDisplay 函数
        function updateQuickSearchDisplay() {
            // 添加防重复更新检查
            if (quicksearchinput.value === quickSearchKeys) return;
            quicksearchinput.value = quickSearchKeys || '';
        }
        // 执行快速搜索
        // 修改 performQuickSearch 函数
        function performQuickSearch() {
            try {
            // 将输入按空格分割为多个查询词（忽略空字符串）
            const queries = quickSearchKeys.trim().toLowerCase().split(/\s+/).filter(q => q.length > 0);
            clearMatches();
            if (queries.length === 0) {
                showAllHistoryItems();
                quickSearchActive = false; // 没有查询词时退出 quick search 状态
                return;
            }
            // 获取所有可搜索元素
            const allElements = document.querySelectorAll('.history-item, button[data-site], .control-buttons button');

            // 先显示所有历史项
            showAllHistoryItems();

            // 所有元素去高亮
            allElements.forEach(el => {
                el.classList.remove('highlight');
            });

            function containsContiguousInPinyin(charSets, query) {
                const m = query.length;
                if (m === 0) return true;
                for (let i = 0; i <= charSets.length - m; i++) {
                    let ok = true;
                    for (let k = 0; k < m; k++) {
                        const setK = charSets[i + k];
                        if (!setK || setK.length === 0 || setK.indexOf(query[k]) === -1) {
                            ok = false;
                            break;
                        }
                    }
                    if (ok) return true;
                }
                return false;
            }

            allElements.forEach(element => {
                const text = (element.textContent || '').toLowerCase();
                const pinyinSets = getPinyinInitials(text);
                let allQueriesMatched = true;

                for (const query of queries) {
                    let queryMatched = false;
                    if (text.indexOf(query) !== -1) {
                        queryMatched = true;
                    } else if (containsContiguousInPinyin(pinyinSets, query)) {
                        queryMatched = true;
                    }
                    if (!queryMatched) { allQueriesMatched = false; break; }
                }

                if (allQueriesMatched) {
                    matchedItems.push({
                        element: element,
                        type: element.classList.contains('history-item') ? 'history' : 'button'
                    });
                    element.classList.add('highlight');
                } else {
                    if (element.classList.contains('history-item')) {
                        element.classList.add('hidden');
                    }
                }
            });

            if (matchedItems.length > 0) {
                currentMatchIndex = 0;
                highlightCurrentMatch();
                currentFocusElement = matchedItems[0].element;
                updatePositionMemory();
                quickSearchActive = true;
            } else {
                quickSearchActive = false;
            }
            } catch (err) {
                console.error('performQuickSearch error:', err);
                quickSearchActive = false;
            }
        }

        function showAllHistoryItems() {
            document.querySelectorAll('.history-item').forEach(item => {
                item.classList.remove('hidden');
            });
        }
        // 使用拼音库获取拼音首字母
        function getPinyinInitials(text) {
            if (!text) return [];
            const dict = (typeof window !== 'undefined' && window.pinyin_dict_firstletter) ? window.pinyin_dict_firstletter : null;
            const result = [];
            // 近似首字母边界（用于无字典时的降级）：对应 A B C D E F G H J K L M N O P Q R S T W X Y Z
            const zhBoundaries = "阿八嚓哒妸发旮哈讥咔垃妈拿哦啪期然撒他哇昔压匝";
            const approxLetters = ["a","b","c","d","e","f","g","h","j","k","l","m","n","o","p","q","r","s","t","w","x","y","z"];
            function approxInitial(unicode) {
                for (let i = 0; i < zhBoundaries.length; i++) {
                    if (unicode < zhBoundaries.charCodeAt(i)) {
                        return [approxLetters[Math.max(0, i - 1)]];
                    }
                }
                return ["z"]; // 超出范围近似为 z
            }
            for (let i = 0; i < text.length; i++) {
                const char = text[i];
                const unicode = char.charCodeAt(0);
                let charSet = [];
                const isChinese = unicode >= 19968 && unicode <= 40869;
                if (isChinese) {
                    if (dict && (dict.all || dict.polyphone)) {
                        if (dict.polyphone && dict.polyphone[unicode]) {
                            const poly = dict.polyphone[unicode];
                            charSet = poly.split("");
                        } else {
                            const idx = unicode - 19968;
                            if (dict.all && idx >= 0 && idx < dict.all.length) {
                                charSet = [dict.all.charAt(idx)];
                            } else {
                                charSet = approxInitial(unicode);
                            }
                        }
                    } else {
                        // 无字典时：使用近似首字母算法
                        charSet = approxInitial(unicode);
                    }
                } else {
                    // 非中文字符：数字和字母直接返回小写自身
                    charSet = [char.toLowerCase()];
                }
                // 统一转小写，避免大小写不一致造成匹配失败
                charSet = charSet.map(c => (c || '').toLowerCase());
                result.push(charSet);
            }
            return result;
        }

        // 快速搜索匹配算法
        function matchesQuery(text, query) {
            let j = 0;
            if (!query) return true;
            for (let i = 0; i < text.length && j < query.length; i++) {
                if (text[i] === query[j]) {
                    j++;
                }
            }
            return j === query.length;
        }

        // 循环切换匹配项
        function cycleMatches(direction) {
            if (matchedItems.length === 0) return;

            // 移除当前高亮
            if (currentMatchIndex >= 0) {
                matchedItems[currentMatchIndex].element.classList.remove('cursor-highlight');
            }

            // 计算新位置
            currentMatchIndex = (currentMatchIndex + direction + matchedItems.length) % matchedItems.length;

            // 设置新位置并高亮
            highlightCurrentMatch();

            // 更新当前焦点元素
            currentFocusElement = matchedItems[currentMatchIndex].element;
            updatePositionMemory();
        }

        // 在匹配项中进行垂直导航（上下键）
        function navigateVerticallyInMatches(direction) {
            if (matchedItems.length === 0 || currentMatchIndex < 0) return;

            const currentElement = matchedItems[currentMatchIndex].element;
            const currentRect = currentElement.getBoundingClientRect();
            
            // 找到在目标方向上的候选匹配项
            const candidates = [];
            
            matchedItems.forEach((item, index) => {
                if (index === currentMatchIndex) return;
                
                const rect = item.element.getBoundingClientRect();
                let isCandidate = false;
                
                if (direction === 'ArrowDown') {
                    // 找下方的匹配项
                    isCandidate = rect.top > currentRect.bottom - 5;
                } else if (direction === 'ArrowUp') {
                    // 找上方的匹配项
                    isCandidate = rect.bottom < currentRect.top + 5;
                }
                
                if (isCandidate) {
                    candidates.push({
                        index: index,
                        element: item.element,
                        rect: rect,
                        verticalDistance: direction === 'ArrowDown' 
                            ? rect.top - currentRect.bottom 
                            : currentRect.top - rect.bottom
                    });
                }
            });
            
            if (candidates.length === 0) return;
            
            // 找到最近的行
            const minDistance = Math.min(...candidates.map(c => c.verticalDistance));
            const nearestRowCandidates = candidates.filter(c => 
                Math.abs(c.verticalDistance - minDistance) < 5
            );
            
            // 在最近行中找到水平位置最接近的匹配项
            let bestCandidate = null;
            let bestScore = -1;
            
            nearestRowCandidates.forEach(candidate => {
                const overlapResult = calculateHorizontalOverlap(currentRect, candidate.rect);
                let score;
                
                // 如果当前控件完全覆盖了目标控件，优先选择最左边的
                if (currentRect.left <= candidate.rect.left && currentRect.right >= candidate.rect.right) {
                    score = 1000 - candidate.rect.left; // 越左边分数越高
                } else {
                    // 否则按重合度排序，重合度越高分数越高
                    score = overlapResult.overlapRatio * 100;
                    // 如果重合度相同，选择水平距离更近的
                    if (overlapResult.overlapRatio > 0) {
                        const centerDistance = Math.abs(
                            (currentRect.left + currentRect.right) / 2 - 
                            (candidate.rect.left + candidate.rect.right) / 2
                        );
                        score = score - centerDistance * 0.01;
                    }
                }
                
                if (score > bestScore) {
                    bestScore = score;
                    bestCandidate = candidate;
                }
            });
            
            // 如果找到了最佳候选项，更新到该项
            if (bestCandidate) {
                // 移除当前高亮
                if (currentMatchIndex >= 0) {
                    matchedItems[currentMatchIndex].element.classList.remove('cursor-highlight');
                }
                
                // 更新到新的匹配项
                currentMatchIndex = bestCandidate.index;
                currentFocusElement = bestCandidate.element;
                updatePositionMemory();
                
                // 高亮新的匹配项
                highlightCurrentMatch();
            }
        }

        // 高亮当前匹配项
        function highlightCurrentMatch() {
            // 移除之前的光标高亮
            document.querySelectorAll('.cursor-highlight').forEach(el => {
                el.classList.remove('cursor-highlight');
            });

            if (currentMatchIndex >= 0 && currentMatchIndex < matchedItems.length) {
                const currentItem = matchedItems[currentMatchIndex];
                currentItem.element.classList.add('cursor-highlight');
                currentItem.element.scrollIntoView({ behavior: 'instant', block: 'nearest' });
            }
        }

        // 激活当前匹配项
        function activateCurrentMatch() {
            if (currentMatchIndex >= 0 && currentMatchIndex < matchedItems.length) {
                const currentItem = matchedItems[currentMatchIndex];

                if (currentItem.type === 'button') {
                    if (currentItem.element.hasAttribute('data-site')) {
                        const site = currentItem.element.getAttribute('data-site');
                        search(site, true);
                    } else {
                        currentItem.element.click();
                    }
                } else if (currentItem.type === 'history') {
                    // 使用增强的历史记录点击处理，将光标定位到最后字符
                    enhancedHistoryItemClick(currentItem.element.textContent);
                }

                quickSearchKeys = '';
                updateQuickSearchDisplay();
                clearMatches();
                quickSearchActive = false;
            }
        }

        // adjustScrollableArea();
        function adjustScrollableArea() {
            const fixedHeader = document.querySelector('.fixed-header');
            const scrollableContent = document.querySelector('.scrollable-content');
            const fixedHeight = fixedHeader.offsetHeight;

            // 保持冻结线位置计算不变
            scrollableContent.style.marginTop = fixedHeight + 'px';

            // 高度计算需考虑padding（通过box-sizing已处理）
            scrollableContent.style.height = `calc(100vh - ${fixedHeight}px)`;
        }

        // 渲染搜索历史
        function renderHistory() {
            if (!historyList) {
                console.error('historyList element not found!');
                return;
            }
            
            historyList.innerHTML = '';
            historyItems = [];

            searchHistory.forEach((keywordObj, index) => {
                const keyword = keywordObj.keyword;
                const item = document.createElement('div');
                item.className = 'history-item';
                if (isEditMode) {
                    item.classList.add('editable');
                }
                item.textContent = keyword;
                item.setAttribute('data-keyword', keyword);
                item.tabIndex = 0;
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (isEditMode) {
                        // 编辑模式下点击直接删除
                        removeFromHistory(keyword);
                    } else {
                        if (e.button === 0) {
                            // 使用增强的历史记录点击处理，将光标定位到最后字符
                            enhancedHistoryItemClick(keyword);
                        } else if (e.button === 2) {
                            toggleSelectElement(item);
                        }
                    }
                });

                item.addEventListener('dblclick', (e) => {
                    e.stopPropagation();
                    const rect = e.target.getBoundingClientRect();
                    const clickPosition = e.clientX - rect.left; // 计算点击位置
                    editHistoryItem(keyword, clickPosition); // 传递位置参数
                });

                item.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    toggleSelectElement(item);
                });

                item.addEventListener('focus', () => {
                    if (!quickSearchActive) {
                        currentFocusElement = item;
                    }
                    updatePositionMemory(); // 更新位置记忆
                });

                historyList.appendChild(item);
                historyItems.push(item);
            });
        }

        // 从历史记录中移除（使用IndexedDB）
        async function removeFromHistory(keyword) {
            try {
                searchHistory = await historyPersistence.remove(keyword);
                renderHistory();
            } catch (error) {
                console.error('删除历史记录失败:', error);
            }
        }


        // 搜索功能（三状态支持）
        function doesSiteAllowBlank(site) {
            const mode = getSiteMode(site);
            return mode === SITE_MODES.BOTH || mode === SITE_MODES.BLANK_ONLY;
        }

        // 检查网站是否允许搜索（有关键词）
        function doesSiteAllowSearch(site) {
            const mode = getSiteMode(site);
            return mode === SITE_MODES.BOTH || mode === SITE_MODES.NO_BLANK;
        }

        async function openSearchResultWithLegacyBackground(keyword, url) {
            const rules = await MySearchBlockingRules.getRulesFromStorage();
            const blockedKeyword = MySearchBlockingRules.findKeyword(
                keyword,
                rules.blockedKeywords
            );
            if (blockedKeyword) {
                return {
                    success: true,
                    opened: false,
                    blocked: true,
                    match: {
                        kind: 'keyword',
                        value: blockedKeyword,
                    },
                };
            }

            const blockedUrlPattern =
                MySearchBlockingRules.findUrlPattern(
                    url,
                    rules.blockedUrlPatterns
                );
            if (blockedUrlPattern) {
                return {
                    success: true,
                    opened: false,
                    blocked: true,
                    match: {
                        kind: 'url',
                        value: blockedUrlPattern,
                    },
                };
            }

            const session = await new Promise((resolve) => {
                try {
                    chrome.runtime.sendMessage({
                        type: 'START_SEARCH_SESSION',
                        targetUrl: url,
                    }, (response) => {
                        void chrome.runtime.lastError;
                        resolve(response || {});
                    });
                } catch (error) {
                    resolve({});
                }
            });

            const currentTab =
                typeof chrome.tabs?.getCurrent === 'function'
                    ? await chrome.tabs.getCurrent()
                    : null;
            const createProperties = {
                url,
                active: true,
            };
            if (Number.isInteger(currentTab?.id)) {
                createProperties.openerTabId = currentTab.id;
            }
            const tab = await chrome.tabs.create(createProperties);

            return {
                success: true,
                opened: true,
                blocked: false,
                sessionEnabled: session?.enabled === true,
                sessionId: session?.sessionId || '',
                tabId: tab?.id,
            };
        }

        function openSearchResult(url) {
            const keyword = searchInput.value.trim();
            const status = typeof blockingRuleStatus === 'undefined'
                ? null
                : blockingRuleStatus;

            if (status) {
                status.dataset.state = '';
                status.textContent = '正在检查阻断规则…';
            }

            return new Promise((resolve) => {
                let settled = false;
                const finish = (response) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timeout);

                    if (!response?.success) {
                        if (status) {
                            status.dataset.state = 'error';
                            status.textContent =
                                response?.error || '搜索检查失败，请重试';
                        }
                        resolve(false);
                        return;
                    }

                    if (response.blocked) {
                        if (status) {
                            status.dataset.state = 'error';
                            status.textContent = response.match?.kind === 'url'
                                ? `已阻断包含 URL 规则“${response.match.value}”的搜索`
                                : `已阻断关键词“${response.match?.value || keyword}”`;
                        }
                        searchInput.focus?.();
                        resolve(false);
                        return;
                    }

                    if (!response.opened) {
                        if (status) {
                            status.dataset.state = 'error';
                            status.textContent = '搜索页未能打开，请重试';
                        }
                        resolve(false);
                        return;
                    }

                    if (status) {
                        status.dataset.state = '';
                        status.textContent = '';
                    }
                    resolve(true);
                };

                const timeout = setTimeout(() => {
                    finish({
                        success: false,
                        error: '插件响应超时，未打开搜索页',
                    });
                }, 5000);

                try {
                    chrome.runtime.sendMessage({
                        type: 'OPEN_SEARCH_RESULT',
                        keyword,
                        targetUrl: url,
                    }, (response) => {
                        const runtimeError = chrome.runtime.lastError;
                        if (runtimeError) {
                            finish({
                                success: false,
                                error: runtimeError.message,
                            });
                            return;
                        }
                        if (
                            MySearchBlockingRules.isUnknownMessageResponse(
                                response,
                                'OPEN_SEARCH_RESULT'
                            )
                        ) {
                            void openSearchResultWithLegacyBackground(
                                keyword,
                                url
                            ).then(finish, (error) => {
                                finish({
                                    success: false,
                                    error:
                                        error?.message ||
                                        '搜索兼容处理失败，请重试',
                                });
                            });
                            return;
                        }
                        finish(response);
                    });
                } catch (error) {
                    finish({
                        success: false,
                        error: error?.message || '搜索检查失败，请重试',
                    });
                }
            });
        }

        function search(site, immediate = false) {
            console.log(`搜索函数：site=${site}, keyword="${searchInput.value.trim()}"`);
            const keyword = searchInput.value.trim();

            if (!siteUrls[site]) {
                console.error(`未知的网站: ${site}`);
                return;
            }

            const siteUrl = siteUrls[site];
            const needsKeyword = shouldAppendKeyword(siteUrl);

            if (keyword) {
                // 有关键词：检查是否允许搜索
                const allowSearch = doesSiteAllowSearch(site);
                console.log(`搜索检查: site=${site}, allowSearch=${allowSearch}`);
                if (!allowSearch) {
                    console.log(`禁止搜索: ${site}`);
                    showErrorModal();
                    
                    // 添加视觉反馈
                    const btn = document.querySelector(`button[data-site="${site}"]`);
                    if (btn) {
                        btn.style.border = '2px solid red';
                        setTimeout(() => {
                            btn.style.border = '';
                        }, 1000);
                    }
                    return;
                }
                
                // 对于不需要拼接关键词的网站（原linkButtons），复制关键词到剪贴板
                if (!needsKeyword) {
                    navigator.clipboard.writeText(keyword).catch(err => {
                        console.error('无法复制到剪贴板:', err);
                    });
                }
                
                const url = buildSearchUrl(site, siteUrl, keyword, needsKeyword);
                openSearchResult(url);
                addToHistory(keyword);
            } else {
                // 无关键词：检查是否允许空白打开
                const allowBlank = doesSiteAllowBlank(site);
                console.log(`空白搜索检查: site=${site}, allowBlank=${allowBlank}`);
                if (!allowBlank) {
                    console.log(`禁止空白打开: ${site}`);
                    showErrorModal();
                    
                    // 添加视觉反馈
                    const btn = document.querySelector(`button[data-site="${site}"]`);
                    if (btn) {
                        btn.style.border = '2px solid red';
                        setTimeout(() => {
                            btn.style.border = '';
                        }, 1000);
                    }
                    return;
                }
                console.log(`允许空白打开: ${site}`);
                
                // 允许空白打开主页
                const url = buildSearchUrl(site, siteUrl, '', needsKeyword);
                openSearchResult(url);
            }
        }

        // 批量搜索函数 - 统一处理逻辑
        function batchSearch(buttons) {
            const keyword = searchInput.value.trim();
            const processedSites = new Set(); // 用集合去重

            // 遍历所有按钮元素
            for (const button of buttons) {
                const site = (typeof button === 'string') ? button : button.getAttribute('data-site');
                if (!site || processedSites.has(site)) continue;

                processedSites.add(site);

                // 检查权限：有关键词时检查是否允许搜索，无关键词时检查是否允许单开
                if (keyword) {
                    if (!doesSiteAllowSearch(site)) continue;
                } else {
                    if (!doesSiteAllowBlank(site)) continue;
                }

                const siteUrl = siteUrls[site];
                const needsKeyword = shouldAppendKeyword(siteUrl);
                
                let url;
                if (keyword) {
                    // 对于不需要拼接关键词的网站，复制关键词到剪贴板
                    if (!needsKeyword) {
                        navigator.clipboard.writeText(keyword).catch(err => {
                            console.error('无法复制到剪贴板:', err);
                        });
                    }
                    url = buildSearchUrl(site, siteUrl, keyword, needsKeyword);
                } else {
                    url = buildSearchUrl(site, siteUrl, '', needsKeyword);
                }

                openSearchResult(url);
            }

            if (keyword) {
                addToHistory(keyword);
            }
        }

        // 导出历史记录（新结构）
        function exportHistory() {
            if (searchHistory.length === 0) return;

            // 使用JSON格式导出
            const content = JSON.stringify(searchHistory, null, 2);
            const blob = new Blob([content], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            // 改进的手机端导出处理
            if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
                // 手机端特殊处理
                const reader = new FileReader();
                reader.onload = function (e) {
                    const modal = document.createElement('div');
                    modal.style.position = 'fixed';
                    modal.style.top = '0';
                    modal.style.left = '0';
                    modal.style.right = '0';
                    modal.style.bottom = '0';
                    modal.style.backgroundColor = 'rgba(0,0,0,0.7)';
                    modal.style.display = 'flex';
                    modal.style.justifyContent = 'center';
                    modal.style.alignItems = 'center';
                    modal.style.zIndex = '2000';

                    const box = document.createElement('div');
                    box.style.backgroundColor = 'white';
                    box.style.padding = '20px';
                    box.style.borderRadius = '5px';
                    box.innerHTML = `
                        <p>请长按下方链接选择"下载"或"保存"</p>
                        <a href="${url}" download="搜索历史.json" style="word-break:break-all;">下载搜索历史</a>
                        <p><button style="margin-top:10px;">关闭</button></p>
                    `;

                    box.querySelector('button').addEventListener('click', () => {
                        document.body.removeChild(modal);
                        URL.revokeObjectURL(url);
                    });

                    modal.appendChild(box);
                    document.body.appendChild(modal);
                };
                reader.readAsDataURL(blob);
            } else {
                // PC端正常下载
                const a = document.createElement('a');
                a.href = url;
                a.download = '搜索历史.json';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(url), 100);
            }
        }

        // 导入历史记录（兼容新旧格式并修复嵌套问题，使用IndexedDB）
        function importHistory() {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json,.txt';
            input.onchange = (e) => {
                const file = e.target.files[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = async (e) => {
                        const content = e.target.result;
                        let newItems = [];

                        try {
                            // 尝试解析为JSON
                            const parsed = JSON.parse(content);
                            if (Array.isArray(parsed)) {
                                // 检查是否为旧格式
                                if (parsed.length > 0) {
                                    if (typeof parsed[0] === 'string') {
                                        // 旧格式字符串数组 -> 转换为新格式
                                        newItems = parsed.map(keyword => ({
                                            keyword,
                                            first_timestamp: new Date().toISOString(),
                                            search_count: 1,
                                            latest_timestamp: new Date().toISOString()
                                        }));
                                    } else if (parsed[0].timestamp && !parsed[0].first_timestamp) {
                                        // 旧格式对象数组 -> 转换为新格式
                                        newItems = parsed.map(item => ({
                                            keyword: item.keyword,
                                            first_timestamp: item.timestamp,
                                            search_count: 1,
                                            latest_timestamp: item.timestamp
                                        }));
                                    } else {
                                        // 已经是新格式或嵌套格式 - 进行规范化处理
                                        newItems = parsed.map(item => {
                                            // 处理嵌套结构：提取最内层keyword字段
                                            if (item.keyword && typeof item.keyword === 'object') {
                                                return {
                                                    keyword: item.keyword.keyword || '',
                                                    first_timestamp: item.keyword.timestamp || new Date().toISOString(),
                                                    search_count: 1,
                                                    latest_timestamp: item.timestamp || new Date().toISOString()
                                                };
                                            }
                                            return item;
                                        });
                                    }
                                }
                            } else {
                                throw new Error("Invalid JSON format: not an array");
                            }
                        } catch (jsonError) {
                            // 如果不是JSON，尝试解析为旧文本格式
                            const lines = content.split('\n').filter(line => line.trim());
                            lines.forEach(line => {
                                // 尝试按制表符分割
                                const parts = line.split('\t');
                                if (parts.length >= 2) {
                                    // 旧格式：关键词\t时间戳 -> 转换为新格式
                                    newItems.push({
                                        keyword: parts[0],
                                        first_timestamp: parts[1],
                                        search_count: 1,
                                        latest_timestamp: parts[1]
                                    });
                                } else {
                                    // 旧格式：只有关键词
                                    const now = new Date().toISOString();
                                    newItems.push({
                                        keyword: line.trim(),
                                        first_timestamp: now,
                                        search_count: 1,
                                        latest_timestamp: now
                                    });
                                }
                            });
                        }

                        // 额外规范化步骤：确保所有项都是扁平结构
                        newItems = newItems.map(item => {
                            if (item.keyword && typeof item.keyword === 'object') {
                                return {
                                    keyword: item.keyword.keyword || '',
                                    first_timestamp: item.keyword.timestamp || new Date().toISOString(),
                                    search_count: item.search_count || 1,
                                    latest_timestamp: item.timestamp || new Date().toISOString()
                                };
                            }
                            return item;
                        });

                        // 将新导入的记录保存到IndexedDB和本地镜像
                        try {
                            searchHistory = await historyPersistence.import(newItems);
                            renderHistory();
                            alert('历史记录导入成功！');
                        } catch (error) {
                            console.error('导入到IndexedDB失败:', error);
                        }
                    };
                    reader.readAsText(file);
                }
            };
            input.click();
        }

        // 编辑历史记录项
        function editHistoryItem(keyword, clickPosition) {
            isEditingHistory = true;
            currentEditItem = document.querySelector(`.history-item[data-keyword="${keyword}"]`);
            if (currentEditItem) {
                historyEditInput.value = keyword;
                editHistoryModal.style.display = 'block';
                
                // 添加点击空白处关闭功能
                const handleEditModalClick = function(e) {
                    if (!e.target.closest('.edit-history-modal')) {
                        editHistoryModal.style.display = 'none';
                        isEditingHistory = false;
                        currentEditItem = null;
                        document.removeEventListener('click', handleEditModalClick);
                    }
                };
                // 延迟添加监听器，避免立即触发
                setTimeout(() => {
                    document.addEventListener('click', handleEditModalClick);
                }, 100);

                // 设置光标位置（使用点击位置计算）
                setTimeout(() => {
                    historyEditInput.focus();
                    // 使用精确计算方法
                    const text = historyEditInput.value;
                    const canvas = document.createElement('canvas');
                    const context = canvas.getContext('2d');
                    context.font = window.getComputedStyle(historyEditInput).font;
                    let position = 0;

                    for (let i = 0; i <= text.length; i++) {
                        const width = context.measureText(text.substring(0, i)).width;
                        if (width > clickPosition) {
                            position = i - 1;
                            break;
                        }
                        if (i === text.length) {
                            position = i;
                        }
                    }

                    historyEditInput.setSelectionRange(position, position);
                }, 50);
            }
        }

        // 输入框输入事件处理
        function handleInput() {
            if (!isEditMode) {
                const keyword = searchInput.value.trim();
                if (keyword) {
                    const matchedHistory = searchHistory.filter(item => item.includes(keyword));
                    if (matchedHistory.length > 0) {
        
                    }
                }
            }
        }
        // 显示所有历史项
        function clearSelection() {
            selectedElements.forEach(el => {
                el.classList.remove('selected');
                if (el === currentFocusElement) {
                    el.focus(); // 保持当前焦点
                }
            });
            selectedElements = [];
        }
        function showAllHistoryItems() {
            document.querySelectorAll('.history-item').forEach(item => {
                item.classList.remove('hidden');
            });
        }
        function toggleSelectElement(element) {
            if (element.classList.contains('selected')) {
                element.classList.remove('selected');
                selectedElements = selectedElements.filter(el => el !== element);
            } else {
                element.classList.add('selected');
                selectedElements.push(element);
                // 确保当前焦点元素更新
                currentFocusElement = element;
            }
        }
        // 删除选中的历史记录（更新为使用新结构）
        async function deleteSelectedHistoryItems() {
            const itemsToDelete = selectedElements.filter(el => el.classList.contains('history-item'));
            if (itemsToDelete.length === 0) return;
        
            // 添加确认弹窗
            if (!confirm(`确定要删除选中的 ${itemsToDelete.length} 条历史记录吗？`)) {
                return;
            }
        
            // 获取当前所有可见历史项（删除之前）
            const allVisibleHistoryItems = Array.from(document.querySelectorAll('.history-item:not(.hidden)'));
            const itemsToDeleteSet = new Set(itemsToDelete);
            // 计算待删的可见项索引集合与基准索引
            const deletedIndices = itemsToDelete
                .map(item => allVisibleHistoryItems.indexOf(item))
                .filter(index => index >= 0)
                .sort((a, b) => a - b);
            const baseIndex = deletedIndices.length ? deletedIndices[0] : Math.max(0, allVisibleHistoryItems.length - 1);

            // 预先选择候选聚焦元素（优先后一个未被删除的可见项，否则前一个）
            let candidateElement = null;
            for (let i = baseIndex; i < allVisibleHistoryItems.length; i++) {
                const el = allVisibleHistoryItems[i];
                if (!itemsToDeleteSet.has(el)) { candidateElement = el; break; }
            }
            if (!candidateElement) {
                for (let i = baseIndex - 1; i >= 0; i--) {
                    const el = allVisibleHistoryItems[i];
                    if (!itemsToDeleteSet.has(el)) { candidateElement = el; break; }
                }
            }
            const candidateKeyword = candidateElement ? candidateElement.getAttribute('data-keyword') : null;
            const visibleToDeleteCount = allVisibleHistoryItems.filter(el => itemsToDeleteSet.has(el)).length;
            const focusSearchIfEmpty = (allVisibleHistoryItems.length - visibleToDeleteCount) <= 0;
            
            
        
            // 保存删除的项用于撤销功能
            lastDeletedItems = itemsToDelete.map(item => {
                const keyword = item.getAttribute('data-keyword');
                // 从searchHistory中找到对应的完整对象（新结构）
                const historyItem = searchHistory.find(item => item.keyword === keyword);
                return {
                    keyword,
                    element: item,
                    historyItem // 存储完整的历史项对象（包含四个字段）
                };
            });
        
            // 执行删除操作，等待所有异步删除与渲染完成
            await Promise.all(itemsToDelete.map(item => {
                const keyword = item.getAttribute('data-keyword');
                return removeFromHistory(keyword);
            }));
        
            // 清除选中状态
            selectedElements = selectedElements.filter(el => !el.classList.contains('history-item'));
        
            // 重新渲染后设置正确的光标位置（两帧后，确保DOM稳定）
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    const newVisibleItems = Array.from(document.querySelectorAll('.history-item:not(.hidden)'));
                    let nextFocus = null;
                    if (focusSearchIfEmpty || newVisibleItems.length === 0) {
                        nextFocus = searchInput;
                    } else if (candidateKeyword) {
                        nextFocus = document.querySelector(`.history-item[data-keyword="${candidateKeyword}"]`);
                        if (!nextFocus) {
                            // 关键词可能变化或被隐藏，按索引兜底
                            const clampedIndex = Math.min(Math.max(baseIndex, 0), newVisibleItems.length - 1);
                            nextFocus = newVisibleItems[clampedIndex] || newVisibleItems[0];
                        }
                    } else {
                        const clampedIndex = Math.min(Math.max(baseIndex, 0), newVisibleItems.length - 1);
                        nextFocus = newVisibleItems[clampedIndex] || newVisibleItems[0];
                    }
                    if (nextFocus) {
                        nextFocus.focus();
                        currentFocusElement = nextFocus;
                        if (nextFocus !== searchInput) {
                            // 确保元素可见且不产生平滑滚动导致的"飞"感
                            nextFocus.scrollIntoView({ behavior: 'auto', block: 'nearest' });
                        }
                    }
                });
            });
        }

        // 显示错误弹窗
        function showErrorModal() {
            console.log('显示错误提示模态框');
            // 确保模态框可见
            errorModal.style.display = 'flex';
            errorModal.style.zIndex = '2000';
            errorModal.style.backgroundColor = 'rgba(255,0,0,0.5)'; // 红色背景更显眼
            errorModal.querySelector('.modal-content').style.border = '2px solid red';
            errorModal.querySelector('p').style.fontSize = '20px';
            errorModal.querySelector('p').style.color = 'white';
            
            setTimeout(() => {
                console.log('隐藏错误提示模态框');
                errorModal.style.display = 'none';
            }, 5000);
        }
        // 改进的方向键导航，参考war-c.js并保留左右键原逻辑
        // 记录上次方向键动作和位置
        let lastDirection = null;
        let positionBeforeUp = null;
        let positionBeforeDown = null;

        function navigateWithArrowKeys(key) {
            const allElements = Array.from(document.querySelectorAll('button, .history-item, input'));
            const currentIndex = allElements.indexOf(currentFocusElement);

            if (currentIndex === -1) {
                const firstFocusable = document.querySelector('button, .history-item, input');
                if (firstFocusable) {
                    firstFocusable.focus();
                    currentFocusElement = firstFocusable;
                }
                return;
            }

            // 恢复到之前的位置逻辑
            if (key === 'ArrowDown' && lastDirection === 'ArrowUp' && positionBeforeUp) {
                setCurrentFocus(positionBeforeUp);
                positionBeforeUp.scrollIntoView({ behavior: 'instant', block: 'nearest' });
                lastDirection = key;
                return;
            }

            if (key === 'ArrowUp' && lastDirection === 'ArrowDown' && positionBeforeDown) {
                setCurrentFocus(positionBeforeDown);
                positionBeforeDown.scrollIntoView({ behavior: 'instant', block: 'nearest' });
                lastDirection = key;
                return;
            }

            // 保存当前位置用于后续恢复
            if (key === 'ArrowUp') {
                positionBeforeUp = currentFocusElement;
            } else if (key === 'ArrowDown') {
                positionBeforeDown = currentFocusElement;
            }

            const currentRect = currentFocusElement.getBoundingClientRect();

            // 上下键使用特殊逻辑：找相邻行中重合度最高的控件
            if (key === 'ArrowDown' || key === 'ArrowUp') {
                const targetElement = findBestVerticalTarget(allElements, currentFocusElement, key);
                if (targetElement) {
                    setCurrentFocus(targetElement);
                    targetElement.scrollIntoView({ behavior: 'instant', block: 'nearest' });
                    lastDirection = key;
                }
                return;
            }

            // 左右键保持原来的逻辑
            let bestCandidate = null;
            let minDistance = Infinity;

            allElements.forEach((el, index) => {
                if (index === currentIndex) return;

                const rect = el.getBoundingClientRect();
                let isCandidate = false;
                let distance = 0;

                if (key === 'ArrowLeft') {
                    // 左右键保持原逻辑，但增加在行尾换行的支持
                    // 首先检查是否在同一行
                    const isSameRow = Math.abs(rect.top - currentRect.top) < 5;
                    
                    if (isSameRow) {
                        // 同行内向左移动
                        isCandidate = rect.right < currentRect.left;
                        distance = currentRect.left - rect.right;
                    } else {
                        // 允许到上一行的最右侧元素
                        // 获取当前元素行内的所有元素
                        const rowElements = allElements.filter(item => 
                            Math.abs(item.getBoundingClientRect().top - currentRect.top) < 5);
                        
                        // 如果当前元素是行内第一个，允许到上一行最后一个
                        const isFirstInRow = !rowElements.some(item => 
                            item.getBoundingClientRect().right < currentRect.left);
                            
                        if (isFirstInRow && rect.top < currentRect.top) {
                            isCandidate = true;
                            // 优先选择上一行最右侧的元素
                            distance = (currentRect.top - rect.bottom) * 100 + 
                                      (window.innerWidth - rect.right);
                        }
                    }
                } else if (key === 'ArrowRight') {
                    // 首先检查是否在同一行
                    const isSameRow = Math.abs(rect.top - currentRect.top) < 5;
                    
                    if (isSameRow) {
                        // 同行内向右移动
                        isCandidate = rect.left > currentRect.right;
                        distance = rect.left - currentRect.right;
                    } else {
                        // 允许到下一行的最左侧元素
                        // 获取当前元素行内的所有元素
                        const rowElements = allElements.filter(item => 
                            Math.abs(item.getBoundingClientRect().top - currentRect.top) < 5);
                        
                        // 如果当前元素是行内最后一个，允许到下一行第一个
                        const isLastInRow = !rowElements.some(item => 
                            item.getBoundingClientRect().left > currentRect.right);
                            
                        if (isLastInRow && rect.top > currentRect.top) {
                            isCandidate = true;
                            // 优先选择下一行最左侧的元素
                            distance = (rect.top - currentRect.bottom) * 100 + rect.left;
                        }
                    }
                }

                if (isCandidate && distance < minDistance) {
                    minDistance = distance;
                    bestCandidate = el;
                }
            });

            if (bestCandidate) {
                setCurrentFocus(bestCandidate);
                bestCandidate.scrollIntoView({ behavior: 'instant', block: 'nearest' });
                lastDirection = key;
            }
        }
        
        // 寻找上下键的最佳目标元素
        function findBestVerticalTarget(allElements, currentElement, direction) {
            const currentRect = currentElement.getBoundingClientRect();
            
            // 步骤1：找到所有候选行
            const candidates = [];
            
            allElements.forEach(el => {
                if (el === currentElement) return;
                
                const rect = el.getBoundingClientRect();
                let isCandidate = false;
                
                if (direction === 'ArrowDown') {
                    isCandidate = rect.top > currentRect.bottom - 5;
                } else if (direction === 'ArrowUp') {
                    isCandidate = rect.bottom < currentRect.top + 5;
                }
                
                if (isCandidate) {
                    candidates.push({
                        element: el,
                        rect: rect,
                        verticalDistance: direction === 'ArrowDown' 
                            ? rect.top - currentRect.bottom 
                            : currentRect.top - rect.bottom
                    });
                }
            });
            
            if (candidates.length === 0) return null;
            
            // 步骤2：找到最近的行
            const minDistance = Math.min(...candidates.map(c => c.verticalDistance));
            const nearestRowCandidates = candidates.filter(c => 
                Math.abs(c.verticalDistance - minDistance) < 5
            );
            
            // 步骤3：在最近行中找到重合度最高的控件
            let bestCandidate = null;
            let bestScore = -1;
            
            nearestRowCandidates.forEach(candidate => {
                const overlapResult = calculateHorizontalOverlap(currentRect, candidate.rect);
                let score;
                
                // 如果当前控件完全覆盖了目标控件，优先选择最左边的
                if (currentRect.left <= candidate.rect.left && currentRect.right >= candidate.rect.right) {
                    score = 1000 - candidate.rect.left; // 越左边分数越高
                } else {
                    // 否则按重合度排序，重合度越高分数越高
                    score = overlapResult.overlapRatio * 100;
                    // 如果重合度相同，选择水平距离更近的
                    if (overlapResult.overlapRatio > 0) {
                        const centerDistance = Math.abs(
                            (currentRect.left + currentRect.right) / 2 - 
                            (candidate.rect.left + candidate.rect.right) / 2
                        );
                        score = score - centerDistance * 0.01;
                    }
                }
                
                if (score > bestScore) {
                    bestScore = score;
                    bestCandidate = candidate;
                }
            });
            
            return bestCandidate ? bestCandidate.element : null;
        }
        
        // 计算两个元素之间的距离，参考war-c.js的distanceElements函数
        function calculateDistance(e1, e2) {
            const rect1 = e1.getBoundingClientRect();
            const rect2 = e2.getBoundingClientRect();
            
            // 创建两个元素的四个角点
            const p1 = [
                { left: rect1.left, top: rect1.top }, // 左上
                { left: rect1.right, top: rect1.top }, // 右上
                { left: rect1.right, top: rect1.bottom }, // 右下
                { left: rect1.left, top: rect1.bottom } // 左下
            ];
            
            const p2 = [
                { left: rect2.left, top: rect2.top }, // 左上
                { left: rect2.right, top: rect2.top }, // 右上
                { left: rect2.right, top: rect2.bottom }, // 右下
                { left: rect2.left, top: rect2.bottom } // 左下
            ];
            
            // 计算每个角点之间的最小距离
            let minDist = Infinity;
            
            for (let i = 0; i < 4; i++) {
                for (let j = 0; j < 4; j++) {
                    const dist = Math.sqrt(
                        Math.pow(p1[i].left - p2[j].left, 2) + 
                        Math.pow(p1[i].top - p2[j].top, 2)
                    );
                    if (dist < minDist) {
                        minDist = dist;
                    }
                }
            }
            
            return minDist;
        }
        
        // 计算角度，参考war-c.js的angle函数
        function calculateAngle(e1, e2) {
            const rect1 = e1.getBoundingClientRect();
            const rect2 = e2.getBoundingClientRect();
            
            // 使用元素中心点计算角度
            const centerX1 = rect1.left + rect1.width / 2;
            const centerY1 = rect1.top + rect1.height / 2;
            const centerX2 = rect2.left + rect2.width / 2;
            const centerY2 = rect2.top + rect2.height / 2;
            
            // 计算角度，单位为度
            return Math.atan2(centerY2 - centerY1, centerX2 - centerX1) * 180 / Math.PI;
        }
        
        // 计算两个矩形的水平重合度
        function calculateHorizontalOverlap(rect1, rect2) {
            // 计算水平方向的重叠部分
            const overlapLeft = Math.max(rect1.left, rect2.left);
            const overlapRight = Math.min(rect1.right, rect2.right);
            const overlap = Math.max(0, overlapRight - overlapLeft);
            
            // 计算重合度比例（相对于较小控件的宽度）
            const rect1Width = rect1.right - rect1.left;
            const rect2Width = rect2.right - rect2.left;
            const smallerWidth = Math.min(rect1Width, rect2Width);
            const overlapRatio = smallerWidth > 0 ? overlap / smallerWidth : 0;
            
            return {
                overlap: overlap,
                overlapRatio: overlapRatio
            };
        }

        // 更新位置记忆 - 记录当前焦点元素在按钮区域或历史区域的位置
        function updatePositionMemory() {
            if (!currentFocusElement) return;
            
            // 检查当前元素是否为按钮
            if (currentFocusElement.tagName === 'BUTTON' && currentFocusElement.hasAttribute('data-site')) {
                lastButtonPosition = currentFocusElement;
            }
            // 检查当前元素是否为历史项
            else if (currentFocusElement.classList.contains('history-item')) {
                lastHistoryPosition = currentFocusElement;
            }
        }

        // 智能Tab跳转 - 在按钮区域和历史区域之间跳转
        function smartTabJump(reverse = false) {
            if (!currentFocusElement) {
                // 如果没有当前焦点，设置到第一个可用元素
                const firstElement = document.querySelector('button[data-site], .history-item');
                if (firstElement) {
                    setCurrentFocus(firstElement);
                }
                return;
            }

            const isCurrentlyOnButton = currentFocusElement.tagName === 'BUTTON' && 
                                       currentFocusElement.hasAttribute('data-site');
            const isCurrentlyOnHistory = currentFocusElement.classList.contains('history-item');

            let targetElement = null;

            if (quickSearchActive && matchedItems.length > 0) {
                // Quick search 状态下：仅在匹配项之间跳转
                if (isCurrentlyOnButton) {
                    // 从按钮跳转到历史区域的匹配项
                    const historyMatches = matchedItems.filter(item => item.type === 'history');
                    if (historyMatches.length > 0) {
                        targetElement = historyMatches[0].element;
                        // 更新 currentMatchIndex
                        currentMatchIndex = matchedItems.findIndex(item => item.element === targetElement);
                    }
                } else if (isCurrentlyOnHistory) {
                    // 从历史项跳转到按钮区域的匹配项
                    const buttonMatches = matchedItems.filter(item => item.type === 'button');
                    if (buttonMatches.length > 0) {
                        targetElement = buttonMatches[0].element;
                        // 更新 currentMatchIndex
                        currentMatchIndex = matchedItems.findIndex(item => item.element === targetElement);
                    }
                }
            } else {
                // 非 quick search 状态下：跳转到上次的位置，如果没有则跳转到第一个
                if (isCurrentlyOnButton) {
                    // 从按钮跳转到历史区域
                    if (lastHistoryPosition && document.contains(lastHistoryPosition)) {
                        targetElement = lastHistoryPosition;
                    } else {
                        // 没有上次位置，跳转到第一个历史项
                        targetElement = document.querySelector('.history-item');
                    }
                } else if (isCurrentlyOnHistory) {
                    // 从历史项跳转到按钮区域
                    if (lastButtonPosition && document.contains(lastButtonPosition)) {
                        targetElement = lastButtonPosition;
                    } else {
                        // 没有上次位置，跳转到第一个按钮
                        targetElement = document.querySelector('button[data-site]');
                    }
                } else {
                    // 当前不在按钮或历史区域，跳转到第一个按钮
                    targetElement = document.querySelector('button[data-site]');
                }
            }

            // 执行跳转
            if (targetElement) {
                setCurrentFocus(targetElement);
                targetElement.scrollIntoView({ behavior: 'instant', block: 'nearest' });
                
                // 如果在 quick search 状态下，更新虚拟光标高亮
                if (quickSearchActive && currentMatchIndex >= 0) {
                    highlightCurrentMatch();
                }
            }
        }

        // 确保设置按钮事件在DOM加载后绑定
        document.addEventListener('DOMContentLoaded', async function () {
            // 移动端自检：验证拼音字典加载与首字母匹配逻辑
            (function quickSearchSelfCheck() {
                try {
                    const dictReady = !!(window.pinyin_dict_firstletter && window.pinyin_dict_firstletter.all);
                    // 简化版连续匹配检测
                    function containsContiguousInPinyin(charSets, query) {
                        const m = query.length;
                        if (m === 0) return true;
                        for (let i = 0; i <= charSets.length - m; i++) {
                            let ok = true;
                            for (let k = 0; k < m; k++) {
                                const setK = charSets[i + k];
                                if (!setK || setK.length === 0 || setK.indexOf(query[k]) === -1) { ok = false; break; }
                            }
                            if (ok) return true;
                        }
                        return false;
                    }
                    const sets = getPinyinInitials('中国');
                    const okZG = containsContiguousInPinyin(sets, 'zg');
                    // 在移动端（含模拟器）显示一次性提示
                    if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
                        setTimeout(() => {
                            try { alert('QuickSearch 自检\n字典: ' + (dictReady ? 'OK' : 'Fallback') + '\nzg→中国: ' + (okZG ? 'OK' : 'FAIL')); } catch (_) {}
                        }, 300);
                    }
                } catch (_) {}
            })();
            
            // 首先加载网站配置
            await loadSiteConfig();
            
            // 注意：历史记录由 initializePage() 统一加载，避免双重加载竞态
            
            // 导出 UA 规则（供浏览器插件使用）
            document.getElementById('export-ua-rules').addEventListener('click', function() {
                exportUARules();
            });

            // 导出 UA 规则（供浏览器插件导入）
            function exportUARules() {
                // UA 预设字符串
                const uaPresets = {
                    desktop: {
                        chrome_windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                        chrome_mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                    },
                    mobile: {
                        iphone_safari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
                        android_chrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
                    }
                };

                const uaRules = {};
                Object.keys(siteFlags).forEach(site => {
                    const flags = siteFlags[site];
                    const url = siteUrls[site] || '';
                    let domain = '';
                    try { domain = new URL(url).hostname; } catch(e) {}
                    // 处理子域名
                    if (domain) {
                        const parts = domain.split('.');
                        if (parts.length > 2) {
                            domain = parts.slice(-2).join('.');
                        }
                    }

                    if (domain) {
                        const isDesktop = flags.desktopMode !== undefined ? flags.desktopMode : true;
                        const uaMode = isDesktop ? 'desktop' : 'mobile';
                        const presetKey = isDesktop ? 'chrome_windows' : 'android_chrome';
                        // 判断是否需要 UI 重排（桌面模式下 B站和抖音需要）
                        const needTransform = isDesktop && (
                            domain.includes('bilibili') || domain.includes('douyin')
                        );

                        uaRules[domain] = {
                            enabled: true,
                            uaMode: uaMode,
                            presetKey: presetKey,
                            customUA: null,
                            uiTransform: needTransform
                        };
                    }
                });

                const exportData = {
                    version: '1.0.0',
                    exportTime: new Date().toISOString(),
                    source: 'MySearchPage',
                    globalEnabled: true,
                    uaRules: uaRules
                };

                const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = 'ua-rules.json';
                a.click();
                URL.revokeObjectURL(a.href);

                // 提示
                const ruleCount = Object.keys(uaRules).length;
                alert(`已导出 ${ruleCount} 条 UA 规则！\n\n请在浏览器插件中点击"导入"按钮，选择导出的 ua-rules.json 文件。`);
            }

        });

        // 重新绑定按钮事件
        function bindButtonEvents() {
            document.querySelectorAll('.btn-group button[data-site]').forEach(button => {
                button.addEventListener('click', (e) => {
                    const site = button.getAttribute('data-site');
                    if (e.button === 0) { // 左键点击
                        if (selectedElements.length > 0 && selectedElements.includes(button)) {
                            toggleSelectElement(button);
                        } else {
                            search(site, true);
                        }
                    }
                });

                // 右键点击多选
                button.addEventListener('contextmenu', (e) => {
                    if (button.getAttribute('data-rightclick') !== 'true') return;
                    e.preventDefault();
                    toggleSelectElement(button);
                });

                button.addEventListener('focus', () => {
                    if (!quickSearchActive) {
                        currentFocusElement = button;
                        quickSearchKeys = '';
                        updateQuickSearchDisplay();
                        clearMatches();
                    }
                    updatePositionMemory(); // 更新位置记忆
                });
            });
        }

        // 撤销删除（使用IndexedDB）
        async function undoDelete() {
            if (lastDeletedItems.length === 0) return;

            try {
                for (const item of lastDeletedItems) {
                    // 检查是否已经存在相同关键词的历史项
                    const exists = searchHistory.some(historyItem => historyItem.keyword === item.keyword);
                    if (!exists && item.historyItem) {
                        searchHistory = await historyPersistence.restore(item.historyItem);
                    }
                }
                
                renderHistory();
                lastDeletedItems = [];
            } catch (error) {
                console.error('撤销删除失败:', error);
            }
        }
        <!-- 保留文件原有内容 -->
        
        // 修复的adjustScrollableArea函数 - 确保historyitem在所有窗口尺寸下都正确显示
        function adjustScrollableArea() {
            const fixedHeader = document.querySelector('.fixed-header');
            const scrollableContent = document.querySelector('.scrollable-content');
            
            if (!fixedHeader || !scrollableContent) {
                return;
            }
            
            // 强制重新测量header高度
            const headerHeight = fixedHeader.getBoundingClientRect().height;
            const safeMarginTop = Math.ceil(headerHeight) + 2; // 使用2px作为安全边距
            
            // 仅设置必要的margin-top和height，保留CSS文件中的padding用于对齐
            scrollableContent.style.marginTop = safeMarginTop + 'px';
            scrollableContent.style.height = `calc(100vh - ${safeMarginTop}px)`;
        }
        
        // 在窗口尺寸变化时重新应用修复
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(adjustScrollableArea, 100);
        });
        
        // 页面加载完成后和定期检查并应用修复（处理异步加载问题）
        // document.addEventListener('DOMContentLoaded', adjustScrollableArea); // 移动到初始化函数中
        // window.addEventListener('load', adjustScrollableArea); // 移动到初始化函数中
        
        // 定期检查（前5秒） - 这个方式不太好，移除
        // const intervalId = setInterval(adjustScrollableArea, 1000);
        // setTimeout(() => clearInterval(intervalId), 5000);

        // 不再需要字体调整逻辑，所有按钮统一16px

        // 页面初始化：立即加载配置和历史记录
        async function initializePage() {
            console.log('开始初始化页面...');
            try {
                // 立即加载网站配置
                await loadSiteConfig();
                console.log('网站配置加载完成');
                
                // 立即加载历史记录
                await loadSearchHistory();
                console.log('历史记录加载完成');
                
                // 初始化增强的搜索框功能
                initializeSearchInputEnhancements();
                
                // 确保UI更新
                // adjustScrollableArea();
                // 渲染历史后，再次调用以确保布局正确
                setTimeout(adjustScrollableArea, 50); // 给予一个小的延迟确保DOM更新
            } catch (error) {
                console.error('页面初始化失败:', error);
            }
        }
        
        // 初始化搜索框增强功能
        function initializeSearchInputEnhancements() {
            if (searchInput) {
                // 监听输入事件，实时更新光标位置记录
                searchInput.addEventListener('input', function(e) {
                    lastInputValue = this.value;
                    lastCursorPosition = getCursorPosition(this);
                });
                
                // 监听光标位置变化（键盘导航、鼠标点击）
                searchInput.addEventListener('selectionchange', function(e) {
                    lastCursorPosition = getCursorPosition(this);
                });
                
                // 监听键盘事件，跟踪光标移动
                searchInput.addEventListener('keyup', function(e) {
                    // 方向键、Home、End键会改变光标位置
                    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
                        lastCursorPosition = getCursorPosition(this);
                    }
                });
                
                // 监听鼠标点击，跟踪光标位置
                searchInput.addEventListener('click', function(e) {
                    setTimeout(() => {
                        lastCursorPosition = getCursorPosition(this);
                    }, 0);
                });
                
                // 监听焦点获得事件
                searchInput.addEventListener('focus', function(e) {
                    // 如果有记录的光标位置，恢复它
                    if (lastInputValue === this.value && lastCursorPosition > 0) {
                        setCursorPosition(this, lastCursorPosition);
                    }
                });
                
                console.log('搜索框增强功能已初始化');
            }
            
            // 为快速搜索输入框添加类似的功能
            if (quicksearchinput) {
                // 监听输入事件，确保光标位置正确
                quicksearchinput.addEventListener('input', function(e) {
                    quickSearchKeys = this.value;
                    performQuickSearch();
                    
                    // 立即确保光标在输入的最后字符位置
                    const position = quickSearchKeys.length;
                    this.setSelectionRange(position, position);
                    console.log(`快速搜索输入光标定位到：${position}`);
                });
                
                // 监听键盘事件，保持光标位置
                quicksearchinput.addEventListener('keydown', function(e) {
                    // 在特定按键后重新定位光标
                    if (['Backspace', 'Delete'].includes(e.key)) {
                        setTimeout(() => {
                            quickSearchKeys = this.value;
                            const position = quickSearchKeys.length;
                            this.setSelectionRange(position, position);
                            console.log(`删除后光标定位到：${position}`);
                        }, 0);
                    }
                });
                
                // 监听键盘释放事件
                quicksearchinput.addEventListener('keyup', function(e) {
                    // 避免方向键改变我们的光标定位逻辑
                    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
                        const position = quickSearchKeys.length;
                        this.setSelectionRange(position, position);
                    }
                });
                
                // 监听焦点获得事件
                quicksearchinput.addEventListener('focus', function(e) {
                    // 确保光标在正确位置
                    const position = quickSearchKeys.length;
                    this.setSelectionRange(position, position);
                    console.log(`焦点获得，光标定位到：${position}`);
                });
                
                // 监听鼠标点击事件
                quicksearchinput.addEventListener('click', function(e) {
                    // 点击后重新定位光标到末尾
                    setTimeout(() => {
                        const position = quickSearchKeys.length;
                        this.setSelectionRange(position, position);
                        console.log(`点击后光标定位到：${position}`);
                    }, 0);
                });
                
                console.log('快速搜索输入框增强功能已初始化');
            }
        }

        // 立即执行初始化，不等待DOMContentLoaded
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initializePage);
        } else {
            // 文档已经加载完成，立即执行
            initializePage();
        }
