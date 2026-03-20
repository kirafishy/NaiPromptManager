# 生图历史分页加载与清理优化实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 解决历史页面因一次性加载所有图片导致的内存崩溃问题，并增强清理功能

**Architecture:** 采用分页加载策略，每次只加载20条记录，最多缓存3页（60条），新增按天数/数量清理功能

**Tech Stack:** TypeScript, React, IndexedDB

---

## Task 1: 修改 localHistory.ts - 添加分页查询方法

**Files:**
- Modify: `services/localHistory.ts`

**Step 1: 添加 getPage 方法**

在 `LocalHistoryService` 类中添加以下方法：

```typescript
/**
 * 分页查询历史记录
 * @param page 页码（从0开始）
 * @param pageSize 每页数量
 * @returns 当前页的记录数组
 */
async getPage(page: number, pageSize: number): Promise<LocalGenItem[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const index = store.index('createdAt');
        
        // 计算跳过的数量
        const skipCount = page * pageSize;
        const results: LocalGenItem[] = [];
        let skipped = 0;
        
        // 从最新记录开始遍历
        const request = index.openCursor(null, 'prev');
        
        request.onsuccess = (event) => {
            const cursor = (event.target as IDBRequest).result;
            if (cursor && results.length < pageSize) {
                if (skipped < skipCount) {
                    skipped++;
                    cursor.continue();
                } else {
                    results.push(cursor.value);
                    cursor.continue();
                }
            } else {
                resolve(results);
            }
        };
        
        request.onerror = () => reject(request.error);
    });
}
```

**Step 2: 添加 getCount 方法**

在 `LocalHistoryService` 类中添加以下方法：

```typescript
/**
 * 获取历史记录总数
 * @returns 记录总数
 */
async getCount(): Promise<number> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.count();
        
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}
```

**Step 3: 验证代码**

检查 `services/localHistory.ts` 文件：
- 确保 `getPage` 方法正确实现分页逻辑
- 确保 `getCount` 方法正确返回总数
- 确保没有语法错误

**Step 4: 提交**

```bash
git add services/localHistory.ts
git commit -m "feat(localHistory): 添加分页查询 getPage 和 getCount 方法"
```

---

## Task 2: 修改 localHistory.ts - 添加清理方法

**Files:**
- Modify: `services/localHistory.ts`

**Step 1: 添加 deleteOlderThan 方法**

在 `LocalHistoryService` 类中添加以下方法：

```typescript
/**
 * 删除指定天数之前的历史记录
 * @param days 天数
 * @returns 删除的记录数量
 */
async deleteOlderThan(days: number): Promise<number> {
    const db = await this.open();
    const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const index = store.index('createdAt');
        let deletedCount = 0;
        
        // 使用范围查询 createdAt < cutoffTime 的记录
        const range = IDBKeyRange.upperBound(cutoffTime, true);
        const request = index.openCursor(range);
        
        request.onsuccess = (event) => {
            const cursor = (event.target as IDBRequest).result;
            if (cursor) {
                cursor.delete();
                deletedCount++;
                cursor.continue();
            } else {
                resolve(deletedCount);
            }
        };
        
        request.onerror = () => reject(request.error);
    });
}
```

**Step 2: 添加 keepOnly 方法**

在 `LocalHistoryService` 类中添加以下方法：

```typescript
/**
 * 只保留最近的 N 条记录，删除多余的
 * @param n 要保留的记录数量
 * @returns 删除的记录数量
 */
async keepOnly(n: number): Promise<number> {
    const db = await this.open();
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const index = store.index('createdAt');
        let deletedCount = 0;
        let index_count = 0;
        
        // 从最新记录开始遍历
        const request = index.openCursor(null, 'prev');
        
        request.onsuccess = (event) => {
            const cursor = (event.target as IDBRequest).result;
            if (cursor) {
                index_count++;
                if (index_count > n) {
                    cursor.delete();
                    deletedCount++;
                }
                cursor.continue();
            } else {
                resolve(deletedCount);
            }
        };
        
        request.onerror = () => reject(request.error);
    });
}
```

**Step 3: 添加 countOlderThan 方法**

在 `LocalHistoryService` 类中添加以下方法：

```typescript
/**
 * 统计指定天数之前的记录数量
 * @param days 天数
 * @returns 记录数量
 */
async countOlderThan(days: number): Promise<number> {
    const db = await this.open();
    const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const index = store.index('createdAt');
        
        // 使用范围查询 createdAt < cutoffTime 的记录
        const range = IDBKeyRange.upperBound(cutoffTime, true);
        const request = index.count(range);
        
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}
```

**Step 4: 验证代码**

检查 `services/localHistory.ts` 文件：
- 确保 `deleteOlderThan` 方法正确删除旧记录
- 确保 `keepOnly` 方法正确保留最新 N 条
- 确保 `countOlderThan` 方法正确统计数量
- 确保没有语法错误

**Step 5: 提交**

```bash
git add services/localHistory.ts
git commit -m "feat(localHistory): 添加 deleteOlderThan、keepOnly、countOlderThan 清理方法"
```

---

## Task 3: 修改 GenHistory.tsx - 添加分页状态和加载逻辑

**Files:**
- Modify: `components/GenHistory.tsx`

**Step 1: 更新状态定义**

将现有的状态定义替换为：

```typescript
const [items, setItems] = useState<LocalGenItem[]>([]);
const [lightbox, setLightbox] = useState<LocalGenItem | null>(null);
const [isPublishing, setIsPublishing] = useState(false);
const [publishTitle, setPublishTitle] = useState('');
const [showSuccessModal, setShowSuccessModal] = useState(false);

// 分页相关状态
const [page, setPage] = useState(0);
const [hasMore, setHasMore] = useState(true);
const [totalCount, setTotalCount] = useState(0);
const [isLoading, setIsLoading] = useState(false);

// 清理相关状态
const [showCleanMenu, setShowCleanMenu] = useState(false);
const [showCleanModal, setShowCleanModal] = useState(false);
const [cleanMode, setCleanMode] = useState<'days' | 'count'>('days');
const [cleanDays, setCleanDays] = useState(7);
const [cleanCount, setCleanCount] = useState(100);
const [cleanPreviewCount, setCleanPreviewCount] = useState(0);
```

**Step 2: 更新 loadData 函数**

将现有的 `loadData` 函数替换为：

```typescript
const PAGE_SIZE = 20;
const MAX_CACHED_PAGES = 3;

const loadData = async (reset = false) => {
    if (isLoading) return;
    
    setIsLoading(true);
    try {
        // 获取总数
        const count = await localHistory.getCount();
        setTotalCount(count);
        
        if (reset) {
            // 重置加载第一页
            const data = await localHistory.getPage(0, PAGE_SIZE);
            setItems(data);
            setPage(1);
            setHasMore(data.length === PAGE_SIZE && count > PAGE_SIZE);
        } else {
            // 加载下一页
            const data = await localHistory.getPage(page, PAGE_SIZE);
            if (data.length > 0) {
                setItems(prev => {
                    const newItems = [...prev, ...data];
                    // 最多保留 MAX_CACHED_PAGES 页数据
                    const maxItems = PAGE_SIZE * MAX_CACHED_PAGES;
                    if (newItems.length > maxItems) {
                        return newItems.slice(-maxItems);
                    }
                    return newItems;
                });
                setPage(prev => prev + 1);
                setHasMore(items.length + data.length < count);
            } else {
                setHasMore(false);
            }
        }
    } catch (e) {
        console.error('加载历史记录失败:', e);
    } finally {
        setIsLoading(false);
    }
};
```

**Step 3: 更新 useEffect**

将现有的 `useEffect` 替换为：

```typescript
useEffect(() => {
    loadData(true);
}, []);
```

**Step 4: 验证代码**

检查 `components/GenHistory.tsx` 文件：
- 确保新状态已正确添加
- 确保 `loadData` 函数实现分页逻辑
- 确保 `useEffect` 正确调用
- 确保没有语法错误

**Step 5: 提交**

```bash
git add components/GenHistory.tsx
git commit -m "feat(GenHistory): 添加分页状态和加载逻辑"
```

---

## Task 4: 修改 GenHistory.tsx - 更新清理 UI

**Files:**
- Modify: `components/GenHistory.tsx`

**Step 1: 添加清理菜单处理函数**

在组件内添加以下函数：

```typescript
const handleCleanMenuClick = (mode: 'days' | 'count') => {
    setCleanMode(mode);
    setShowCleanMenu(false);
    setShowCleanModal(true);
    
    // 预览将删除的数量
    if (mode === 'days') {
        localHistory.countOlderThan(cleanDays).then(setCleanPreviewCount);
    } else {
        localHistory.getCount().then(count => {
            setCleanPreviewCount(Math.max(0, count - cleanCount));
        });
    }
};

const handleCleanConfirm = async () => {
    try {
        if (cleanMode === 'days') {
            await localHistory.deleteOlderThan(cleanDays);
        } else {
            await localHistory.keepOnly(cleanCount);
        }
        setShowCleanModal(false);
        loadData(true); // 重新加载第一页
        notify('清理完成');
    } catch (e: any) {
        notify('清理失败: ' + e.message, 'error');
    }
};
```

**Step 2: 更新顶部栏**

将现有的顶部栏替换为：

```typescript
<header className="p-4 md:p-6 bg-white dark:bg-gray-800 shadow-md flex justify-between items-center border-b border-gray-200 dark:border-gray-700 z-10 flex-shrink-0">
    <div>
        <h1 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">本地生图历史</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400">仅存储在您的浏览器中</p>
    </div>
    <div className="flex gap-2 md:gap-3 items-center">
        <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center">共 {totalCount} 张</div>
        <div className="relative">
            <button 
                onClick={() => setShowCleanMenu(!showCleanMenu)} 
                className="px-3 py-1 md:px-4 md:py-2 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded text-xs md:text-sm hover:bg-red-200 dark:hover:bg-red-900/50 flex items-center gap-1"
            >
                清理
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>
            {showCleanMenu && (
                <div className="absolute right-0 mt-1 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-20">
                    <button 
                        onClick={handleClearAll} 
                        className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 rounded-t-lg"
                    >
                        🗑️ 清空全部
                    </button>
                    <button 
                        onClick={() => handleCleanMenuClick('days')} 
                        className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                    >
                        ⏰ 删除 X 天前的...
                    </button>
                    <button 
                        onClick={() => handleCleanMenuClick('count')} 
                        className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 rounded-b-lg"
                    >
                        📊 只保留最近 N 张...
                    </button>
                </div>
            )}
        </div>
        <button onClick={() => loadData(true)} className="px-3 py-1 md:px-4 md:py-2 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded text-xs md:text-sm hover:bg-gray-200 dark:hover:bg-gray-600">
            刷新
        </button>
    </div>
</header>
```

**Step 3: 验证代码**

检查 `components/GenHistory.tsx` 文件：
- 确保清理菜单正确显示
- 确保清理处理函数正确实现
- 确保没有语法错误

**Step 4: 提交**

```bash
git add components/GenHistory.tsx
git commit -m "feat(GenHistory): 更新清理 UI，添加下拉菜单"
```

---

## Task 5: 修改 GenHistory.tsx - 添加清理确认弹窗和底部加载区域

**Files:**
- Modify: `components/GenHistory.tsx`

**Step 1: 添加清理确认弹窗**

在组件的 return 语句中，Lightbox 之后添加：

```typescript
{/* Clean Modal */}
{showCleanModal && (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-sm w-full shadow-2xl">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">⚠️ 确认清理</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                {cleanMode === 'days' 
                    ? `将删除 ${cleanDays} 天前的 ${cleanPreviewCount} 张图片`
                    : `当前共 ${totalCount} 张，将删除 ${cleanPreviewCount} 张，只保留最近 ${cleanCount} 张`
                }
            </p>
            <p className="text-xs text-red-500 mb-4">此操作无法恢复</p>
            
            <div className="mb-4">
                {cleanMode === 'days' ? (
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">天数</label>
                        <input
                            type="number"
                            min="1"
                            value={cleanDays}
                            onChange={e => {
                                setCleanDays(Number(e.target.value));
                                localHistory.countOlderThan(Number(e.target.value)).then(setCleanPreviewCount);
                            }}
                            className="w-full px-3 py-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm outline-none dark:text-white"
                        />
                    </div>
                ) : (
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">保留数量</label>
                        <input
                            type="number"
                            min="1"
                            value={cleanCount}
                            onChange={e => {
                                setCleanCount(Number(e.target.value));
                                localHistory.getCount().then(count => {
                                    setCleanPreviewCount(Math.max(0, count - Number(e.target.value)));
                                });
                            }}
                            className="w-full px-3 py-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm outline-none dark:text-white"
                        />
                    </div>
                )}
            </div>
            
            <div className="flex gap-2">
                <button
                    onClick={() => setShowCleanModal(false)}
                    className="flex-1 py-2 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg font-bold"
                >
                    取消
                </button>
                <button
                    onClick={handleCleanConfirm}
                    className="flex-1 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg font-bold"
                >
                    确认删除
                </button>
            </div>
        </div>
    </div>
)}
```

**Step 2: 添加底部加载区域**

将现有的空状态判断替换为：

```typescript
{items.length === 0 ? (
    <div className="h-full flex flex-col items-center justify-center text-gray-400">
        <div className="text-4xl mb-2">🕰️</div>
        <p>暂无生成记录</p>
        <p className="text-sm mt-2">在 Chain 编辑器中生成图片会自动保存到这里</p>
    </div>
) : (
    <>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 md:gap-4">
            {items.map(item => (
                <div
                    key={item.id}
                    className="group relative aspect-square bg-gray-200 dark:bg-gray-800 rounded-lg overflow-hidden cursor-pointer border border-gray-200 dark:border-gray-700 hover:border-indigo-500 transition-colors"
                    onClick={() => setLightbox(item)}
                >
                    <img src={item.imageUrl} className="w-full h-full object-cover" loading="lazy" />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                    <div className="absolute top-2 right-2 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={(e) => handleDelete(item.id, e)} className="p-1.5 bg-red-500 text-white rounded-full shadow hover:bg-red-600">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent text-white text-[10px] opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity truncate">
                        {new Date(item.createdAt).toLocaleString()}
                    </div>
                </div>
            ))}
        </div>
        
        {/* 底部加载区域 */}
        <div className="flex flex-col items-center justify-center py-8">
            {isLoading ? (
                <div className="text-gray-500 dark:text-gray-400">⏳ 加载中...</div>
            ) : hasMore ? (
                <>
                    <button
                        onClick={() => loadData(false)}
                        className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold shadow-lg transition-colors"
                    >
                        加载更多
                    </button>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                        已加载 {items.length} / {totalCount} 张
                    </p>
                </>
            ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                    ✓ 已加载全部 {totalCount} 张
                </p>
            )}
        </div>
    </>
)}
```

**Step 3: 验证代码**

检查 `components/GenHistory.tsx` 文件：
- 确保清理确认弹窗正确显示
- 确保底部加载区域正确显示
- 确保没有语法错误

**Step 4: 提交**

```bash
git add components/GenHistory.tsx
git commit -m "feat(GenHistory): 添加清理确认弹窗和底部加载区域"
```

---

## Task 6: 测试和最终提交

**Files:**
- None (manual testing)

**Step 1: 启动开发服务器**

```bash
npm run dev
```

**Step 2: 测试分页加载**

1. 打开历史页面
2. 验证只加载了 20 条记录
3. 点击「加载更多」按钮
4. 验证加载了第二页数据
5. 验证底部显示「已加载 40 / X 张」

**Step 3: 测试清理功能**

1. 点击「清理」下拉菜单
2. 验证显示 3 个选项
3. 点击「删除 X 天前的...」
4. 验证弹窗显示预估删除数量
5. 修改天数，验证预估数量更新
6. 取消操作

**Step 4: 测试内存控制**

1. 多次点击「加载更多」加载 3 页以上数据
2. 验证内存中只保留最近 60 条（3 页）
3. 验证页面不崩溃

**Step 5: 最终提交**

```bash
git add .
git commit -m "feat: 完成生图历史分页加载与清理优化"
git push
```

---

## 完成检查清单

- [ ] localHistory.ts 添加了 getPage、getCount 方法
- [ ] localHistory.ts 添加了 deleteOlderThan、keepOnly、countOlderThan 方法
- [ ] GenHistory.tsx 添加了分页状态和加载逻辑
- [ ] GenHistory.tsx 更新了清理 UI（下拉菜单）
- [ ] GenHistory.tsx 添加了清理确认弹窗
- [ ] GenHistory.tsx 添加了底部加载区域
- [ ] 分页加载功能正常工作
- [ ] 清理功能正常工作
- [ ] 内存占用可控（最多 60 条）
- [ ] 所有代码已提交