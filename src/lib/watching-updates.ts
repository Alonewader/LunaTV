'use client';

import { getAllPlayRecords, PlayRecord, generateStorageKey } from './db.client';

// 缓存键
const WATCHING_UPDATES_CACHE_KEY = 'moontv_watching_updates';
const LAST_CHECK_TIME_KEY = 'moontv_last_update_check';
const CACHE_DURATION = 5 * 60 * 1000; // 5分钟缓存

// 事件名称
export const WATCHING_UPDATES_EVENT = 'watchingUpdatesChanged';

// 更新信息接口
export interface WatchingUpdate {
  hasUpdates: boolean;
  timestamp: number;
  updatedCount: number;
  updatedSeries: {
    title: string;
    source_name: string;
    year: string;
    currentEpisode: number;
    totalEpisodes: number;
    hasNewEpisode: boolean;
    newEpisodes?: number;
    latestEpisodes?: number;
  }[];
}

interface WatchingUpdatesCache {
  hasUpdates: boolean;
  timestamp: number;
  updatedCount: number;
  updatedSeries: WatchingUpdate['updatedSeries'];
}

interface ExtendedPlayRecord extends PlayRecord {
  id: string;
  hasUpdate?: boolean;
  newEpisodes?: number;
}

// 全局事件监听器
const updateListeners = new Set<(hasUpdates: boolean) => void>();

/**
 * 检查追番更新
 * 真实API调用检查用户的播放记录，检测是否有新集数更新
 */
export async function checkWatchingUpdates(): Promise<void> {
  try {
    console.log('开始检查追番更新...');

    // 检查缓存是否有效
    const lastCheckTime = parseInt(localStorage.getItem(LAST_CHECK_TIME_KEY) || '0');
    const currentTime = Date.now();

    if (currentTime - lastCheckTime < CACHE_DURATION) {
      console.log('距离上次检查时间太短，使用缓存结果');
      const cached = getCachedWatchingUpdates();
      notifyListeners(cached);
      return;
    }

    // 获取用户的播放记录
    const recordsObj = await getAllPlayRecords();
    const records = Object.entries(recordsObj).map(([key, record]) => ({
      ...record,
      id: key
    }));

    if (records.length === 0) {
      console.log('无播放记录，跳过更新检查');
      const emptyResult: WatchingUpdate = {
        hasUpdates: false,
        timestamp: currentTime,
        updatedCount: 0,
        updatedSeries: []
      };
      cacheWatchingUpdates(emptyResult);
      localStorage.setItem(LAST_CHECK_TIME_KEY, currentTime.toString());
      notifyListeners(false);
      return;
    }

    // 筛选多集剧且未看完的记录
    const candidateRecords = records.filter(record => {
      return record.total_episodes > 1 && record.index < record.total_episodes;
    });

    console.log(`找到 ${candidateRecords.length} 个可能有更新的剧集`);

    let hasAnyUpdates = false;
    let updatedCount = 0;
    const updatedSeries: WatchingUpdate['updatedSeries'] = [];

    // 并发检查所有记录的更新状态
    const updatePromises = candidateRecords.map(async (record) => {
      try {
        // 从存储key中解析出videoId
        const [sourceName, videoId] = record.id.split('+');
        const updateInfo = await checkSingleRecordUpdate(record, videoId);

        const seriesInfo = {
          title: record.title,
          source_name: record.source_name,
          year: record.year,
          currentEpisode: record.index,
          totalEpisodes: record.total_episodes,
          hasNewEpisode: updateInfo.hasUpdate,
          newEpisodes: updateInfo.newEpisodes,
          latestEpisodes: updateInfo.latestEpisodes
        };

        updatedSeries.push(seriesInfo);

        if (updateInfo.hasUpdate) {
          hasAnyUpdates = true;
          updatedCount++;
        }

        return seriesInfo;
      } catch (error) {
        console.error(`检查 ${record.title} 更新失败:`, error);
        // 返回默认状态
        const seriesInfo = {
          title: record.title,
          source_name: record.source_name,
          year: record.year,
          currentEpisode: record.index,
          totalEpisodes: record.total_episodes,
          hasNewEpisode: false,
          newEpisodes: 0,
          latestEpisodes: record.total_episodes
        };
        updatedSeries.push(seriesInfo);
        return seriesInfo;
      }
    });

    await Promise.all(updatePromises);

    console.log(`检查完成: ${hasAnyUpdates ? `发现${updatedCount}部剧集有更新` : '暂无更新'}`);

    // 缓存结果
    const result: WatchingUpdate = {
      hasUpdates: hasAnyUpdates,
      timestamp: currentTime,
      updatedCount,
      updatedSeries
    };

    cacheWatchingUpdates(result);
    localStorage.setItem(LAST_CHECK_TIME_KEY, currentTime.toString());

    // 通知监听器
    notifyListeners(hasAnyUpdates);

    // 触发全局事件
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(WATCHING_UPDATES_EVENT, {
        detail: { hasUpdates: hasAnyUpdates, updatedCount }
      }));
    }

  } catch (error) {
    console.error('检查追番更新失败:', error);
    notifyListeners(false);
  }
}

/**
 * 检查单个剧集的更新状态（调用真实API）
 */
async function checkSingleRecordUpdate(record: PlayRecord, videoId: string): Promise<{ hasUpdate: boolean; newEpisodes: number; latestEpisodes: number }> {
  try {
    let sourceKey = record.source_name;

    // 先尝试获取可用数据源进行映射
    try {
      const sourcesResponse = await fetch('/api/sources');
      if (sourcesResponse.ok) {
        const sources = await sourcesResponse.json();

        // 查找匹配的数据源
        const matchedSource = sources.find((source: any) =>
          source.key === record.source_name ||
          source.name === record.source_name
        );

        if (matchedSource) {
          sourceKey = matchedSource.key;
          console.log(`映射数据源: ${record.source_name} -> ${sourceKey}`);
        } else {
          console.warn(`找不到数据源 ${record.source_name} 的映射，使用原始名称`);
        }
      }
    } catch (mappingError) {
      console.warn('数据源映射失败，使用原始名称:', mappingError);
    }

    // 使用映射后的key调用API
    const response = await fetch(`/api/detail?source=${sourceKey}&id=${videoId}`);
    if (!response.ok) {
      console.warn(`获取${record.title}详情失败:`, response.status);
      return { hasUpdate: false, newEpisodes: 0, latestEpisodes: record.total_episodes };
    }

    const detailData = await response.json();
    const latestEpisodes = detailData.episodes ? detailData.episodes.length : 0;

    // 比较集数，如果用户已看到最新集且没有新增集数，则不计入更新
    const hasUpdate = latestEpisodes > record.total_episodes;
    const userWatchedLatest = record.index >= record.total_episodes;
    const newEpisodes = hasUpdate ? latestEpisodes - record.total_episodes : 0;

    // 只有当有新集数且用户没有看到最新集时才算作更新
    // 如果用户已经看到了当前记录的最新集，且总集数没有增加，则不显示更新
    const shouldShowUpdate = hasUpdate && (!userWatchedLatest || latestEpisodes > record.total_episodes);

    if (shouldShowUpdate) {
      console.log(`${record.title} 发现更新: ${record.total_episodes} -> ${latestEpisodes} 集`);
    }

    return {
      hasUpdate: shouldShowUpdate,
      newEpisodes,
      latestEpisodes
    };
  } catch (error) {
    console.error(`检查${record.title}更新失败:`, error);
    return { hasUpdate: false, newEpisodes: 0, latestEpisodes: record.total_episodes };
  }
}

/**
 * 获取缓存的更新信息
 */
export function getCachedWatchingUpdates(): boolean {
  try {
    const cached = localStorage.getItem(WATCHING_UPDATES_CACHE_KEY);
    if (!cached) return false;

    const data: WatchingUpdatesCache = JSON.parse(cached);
    const isExpired = Date.now() - data.timestamp > CACHE_DURATION;

    return isExpired ? false : data.hasUpdates;
  } catch (error) {
    console.error('读取更新缓存失败:', error);
    return false;
  }
}

/**
 * 缓存更新信息
 */
function cacheWatchingUpdates(data: WatchingUpdate): void {
  try {
    const cacheData: WatchingUpdatesCache = {
      hasUpdates: data.hasUpdates,
      timestamp: data.timestamp,
      updatedCount: data.updatedCount,
      updatedSeries: data.updatedSeries
    };
    localStorage.setItem(WATCHING_UPDATES_CACHE_KEY, JSON.stringify(cacheData));
  } catch (error) {
    console.error('缓存更新信息失败:', error);
  }
}

/**
 * 订阅更新通知
 */
export function subscribeToWatchingUpdates(callback: (hasUpdates: boolean) => void): () => void {
  updateListeners.add(callback);

  // 返回取消订阅函数
  return () => {
    updateListeners.delete(callback);
  };
}

/**
 * 通知所有监听器
 */
function notifyListeners(hasUpdates: boolean): void {
  updateListeners.forEach(callback => {
    try {
      callback(hasUpdates);
    } catch (error) {
      console.error('通知更新监听器失败:', error);
    }
  });
}

/**
 * 设置定期检查
 * @param intervalMinutes 检查间隔（分钟）
 */
export function setupPeriodicUpdateCheck(intervalMinutes = 30): () => void {
  console.log(`设置定期更新检查，间隔: ${intervalMinutes} 分钟`);

  // 立即执行一次检查
  checkWatchingUpdates();

  // 设置定期检查
  const intervalId = setInterval(() => {
    checkWatchingUpdates();
  }, intervalMinutes * 60 * 1000);

  // 返回清理函数
  return () => {
    clearInterval(intervalId);
  };
}

/**
 * 页面可见性变化时自动检查更新
 */
export function setupVisibilityChangeCheck(): () => void {
  if (typeof window === 'undefined') {
    // 服务器端渲染时返回空操作函数
    return () => void 0;
  }

  const handleVisibilityChange = () => {
    if (!document.hidden) {
      // 页面变为可见时检查更新
      checkWatchingUpdates();
    }
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);

  return () => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  };
}

/**
 * 获取详细的更新信息
 */
export function getDetailedWatchingUpdates(): WatchingUpdate | null {
  try {
    const cached = localStorage.getItem(WATCHING_UPDATES_CACHE_KEY);
    if (!cached) return null;

    const data: WatchingUpdatesCache = JSON.parse(cached);
    const isExpired = Date.now() - data.timestamp > CACHE_DURATION;

    if (isExpired) return null;

    return {
      hasUpdates: data.hasUpdates,
      timestamp: data.timestamp,
      updatedCount: data.updatedCount,
      updatedSeries: data.updatedSeries
    };
  } catch (error) {
    console.error('读取详细更新信息失败:', error);
    return null;
  }
}

/**
 * 手动标记已查看更新
 */
export function markUpdatesAsViewed(): void {
  try {
    const data = getDetailedWatchingUpdates();
    if (data) {
      const updatedData: WatchingUpdate = {
        ...data,
        hasUpdates: false,
        updatedCount: 0,
        updatedSeries: data.updatedSeries.map(series => ({
          ...series,
          hasNewEpisode: false
        }))
      };
      cacheWatchingUpdates(updatedData);
      notifyListeners(false);

      // 触发全局事件
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(WATCHING_UPDATES_EVENT, {
          detail: { hasUpdates: false, updatedCount: 0 }
        }));
      }
    }
  } catch (error) {
    console.error('标记更新为已查看失败:', error);
  }
}

/**
 * 清除新集数更新状态（来自Alpha版本）
 */
export function clearWatchingUpdates(): void {
  try {
    localStorage.removeItem(WATCHING_UPDATES_CACHE_KEY);
    localStorage.removeItem(LAST_CHECK_TIME_KEY);

    // 通知监听器
    notifyListeners(false);

    // 触发事件通知状态变化
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(WATCHING_UPDATES_EVENT, {
        detail: { hasUpdates: false, updatedCount: 0 }
      }));
    }
  } catch (error) {
    console.error('清除新集数更新状态失败:', error);
  }
}

/**
 * 检查特定视频的更新状态（用于视频详情页面）
 */
export async function checkVideoUpdate(sourceName: string, videoId: string): Promise<void> {
  try {
    const recordsObj = await getAllPlayRecords();
    const storageKey = generateStorageKey(sourceName, videoId);
    const targetRecord = recordsObj[storageKey];

    if (!targetRecord) {
      return;
    }

    const updateInfo = await checkSingleRecordUpdate(targetRecord, videoId);

    if (updateInfo.hasUpdate) {
      // 如果发现这个视频有更新，重新检查所有更新状态
      await checkWatchingUpdates();
    }
  } catch (error) {
    console.error('检查视频更新失败:', error);
  }
}

/**
 * 订阅新集数更新事件（来自Alpha版本）
 */
export function subscribeToWatchingUpdatesEvent(callback: (hasUpdates: boolean, updatedCount: number) => void): () => void {
  if (typeof window === 'undefined') {
    return () => void 0;
  }

  const handleUpdate = (event: CustomEvent) => {
    const { hasUpdates, updatedCount } = event.detail;
    callback(hasUpdates, updatedCount);
  };

  window.addEventListener(WATCHING_UPDATES_EVENT, handleUpdate as EventListener);

  return () => {
    window.removeEventListener(WATCHING_UPDATES_EVENT, handleUpdate as EventListener);
  };
}