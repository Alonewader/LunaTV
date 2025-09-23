'use client';

import { useEffect, useState } from 'react';
import { Calendar, Filter, Search, Clock, Film, Tv, MapPin, Tag, ChevronUp } from 'lucide-react';

import { ReleaseCalendarItem, ReleaseCalendarResult } from '@/lib/types';
import PageLayout from '@/components/PageLayout';

export default function ReleaseCalendarPage() {
  const [data, setData] = useState<ReleaseCalendarResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 过滤状态
  const [filters, setFilters] = useState({
    type: '' as 'movie' | 'tv' | '',
    region: '',
    genre: '',
    dateFrom: '',
    dateTo: '',
    search: '',
  });

  // 分页状态
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  // 视图模式
  const [viewMode, setViewMode] = useState<'grid' | 'timeline'>('grid');

  // 返回顶部按钮状态
  const [showBackToTop, setShowBackToTop] = useState(false);

  // 清理过期缓存
  const cleanExpiredCache = () => {
    const CACHE_DURATION = 2 * 60 * 60 * 1000; // 2小时
    const now = Date.now();

    // 检查release calendar缓存
    const cacheTimeKey = 'release_calendar_all_data_time';
    const cachedTime = localStorage.getItem(cacheTimeKey);

    if (cachedTime) {
      const age = now - parseInt(cachedTime);
      if (age >= CACHE_DURATION) {
        localStorage.removeItem('release_calendar_all_data');
        localStorage.removeItem(cacheTimeKey);
        console.log('已清理过期的发布日历缓存');
      }
    }

    // 清理其他可能过期的缓存项
    const keysToCheck = [
      'upcoming_releases_cache',
      'upcoming_releases_cache_time'
    ];

    keysToCheck.forEach(key => {
      if (key.endsWith('_time')) {
        const timeStr = localStorage.getItem(key);
        if (timeStr) {
          const age = now - parseInt(timeStr);
          if (age >= CACHE_DURATION) {
            const dataKey = key.replace('_time', '');
            localStorage.removeItem(dataKey);
            localStorage.removeItem(key);
            console.log(`已清理过期缓存: ${dataKey}`);
          }
        }
      }
    });
  };

  // 获取数据
  const fetchData = async (reset = false) => {
    try {
      setLoading(true);
      setError(null);

      // 清理过期缓存
      cleanExpiredCache();

      // 统一缓存键，不基于过滤条件
      const cacheKey = 'release_calendar_all_data';
      const cacheTimeKey = 'release_calendar_all_data_time';
      const CACHE_DURATION = 2 * 60 * 60 * 1000; // 2小时

      // 检查缓存（除非强制重置）
      if (!reset) {
        const cachedData = localStorage.getItem(cacheKey);
        const cachedTime = localStorage.getItem(cacheTimeKey);

        if (cachedData && cachedTime) {
          const age = Date.now() - parseInt(cachedTime);
          if (age < CACHE_DURATION) {
            console.log('使用缓存的发布日历数据，缓存年龄:', Math.round(age / 1000 / 60), '分钟');
            // 使用缓存的完整数据，前端过滤
            const allData = JSON.parse(cachedData);
            const filteredData = applyClientSideFilters(allData);
            setData(filteredData);
            setCurrentPage(1);
            setLoading(false);
            return;
          }
        }
      }

      // 获取所有数据，不在API层过滤
      console.log('🌐 正在从服务器获取最新数据...');
      const response = await fetch(`/api/release-calendar`);
      if (!response.ok) {
        throw new Error('获取数据失败');
      }

      const result: ReleaseCalendarResult = await response.json();
      console.log(`📊 获取到 ${result.items.length} 条上映数据`);

      // 缓存完整数据
      localStorage.setItem(cacheKey, JSON.stringify(result));
      localStorage.setItem(cacheTimeKey, Date.now().toString());
      console.log('💾 数据已缓存到本地');

      // 前端过滤
      const filteredData = applyClientSideFilters(result);
      setData(filteredData);

      setCurrentPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setLoading(false);
    }
  };

  // 前端过滤逻辑
  const applyClientSideFilters = (data: ReleaseCalendarResult): ReleaseCalendarResult => {
    return applyClientSideFiltersWithParams(data, filters);
  };

  // 前端过滤逻辑（可以指定过滤参数）
  const applyClientSideFiltersWithParams = (data: ReleaseCalendarResult, filterParams: typeof filters): ReleaseCalendarResult => {
    let filteredItems = [...data.items];

    if (filterParams.type) {
      filteredItems = filteredItems.filter(item => item.type === filterParams.type);
    }

    if (filterParams.region && filterParams.region !== '全部') {
      filteredItems = filteredItems.filter(item =>
        item.region.includes(filterParams.region!)
      );
    }

    if (filterParams.genre && filterParams.genre !== '全部') {
      filteredItems = filteredItems.filter(item =>
        item.genre.includes(filterParams.genre!)
      );
    }

    if (filterParams.dateFrom) {
      filteredItems = filteredItems.filter(item =>
        item.releaseDate >= filterParams.dateFrom!
      );
    }

    if (filterParams.dateTo) {
      filteredItems = filteredItems.filter(item =>
        item.releaseDate <= filterParams.dateTo!
      );
    }

    if (filterParams.search) {
      filteredItems = filteredItems.filter(item =>
        item.title.toLowerCase().includes(filterParams.search.toLowerCase()) ||
        item.director.toLowerCase().includes(filterParams.search.toLowerCase()) ||
        item.actors.toLowerCase().includes(filterParams.search.toLowerCase())
      );
    }

    return {
      ...data,
      items: filteredItems,
      total: filteredItems.length,
      hasMore: false // 前端分页，所以没有更多数据
    };
  };

  // 应用过滤器
  const applyFilters = () => {
    setCurrentPage(1);

    // 如果有缓存数据，直接前端过滤
    const cachedData = localStorage.getItem('release_calendar_all_data');
    if (cachedData) {
      const allData = JSON.parse(cachedData);
      const filteredData = applyClientSideFilters(allData);
      setData(filteredData);
    } else {
      // 没有缓存则重新获取
      fetchData(false);
    }
  };

  // 处理刷新按钮点击
  const handleRefreshClick = async () => {
    console.log('📅 刷新上映日程数据...');

    try {
      // 清除缓存并强制刷新
      localStorage.removeItem('release_calendar_all_data');
      localStorage.removeItem('release_calendar_all_data_time');
      console.log('✅ 已清除上映日程缓存');

      await fetchData(true);
      console.log('🎉 上映日程数据刷新成功！');
    } catch (error) {
      console.error('❌ 刷新上映日程数据失败:', error);
    }
  };

  // 重置过滤器
  const resetFilters = () => {
    const resetFiltersState = {
      type: '' as 'movie' | 'tv' | '',
      region: '',
      genre: '',
      dateFrom: '',
      dateTo: '',
      search: '',
    };

    setFilters(resetFiltersState);
    setCurrentPage(1);

    // 如果有缓存数据，使用重置后的过滤条件重新应用过滤
    const cachedData = localStorage.getItem('release_calendar_all_data');
    if (cachedData) {
      const allData = JSON.parse(cachedData);
      // 直接使用重置后的过滤条件，而不是依赖state（state更新是异步的）
      const filteredData = applyClientSideFiltersWithParams(allData, resetFiltersState);
      setData(filteredData);
    } else {
      fetchData(false);
    }
  };

  // 前端分页逻辑
  const totalItems = data?.items.length || 0;
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentItems = data?.items.slice(startIndex, endIndex) || [];

  // 客户端搜索过滤
  const filteredItems = data?.items.filter(item => {
    if (!filters.search) return true;
    const searchLower = filters.search.toLowerCase();
    return (
      item.title.toLowerCase().includes(searchLower) ||
      item.director.toLowerCase().includes(searchLower) ||
      item.actors.toLowerCase().includes(searchLower)
    );
  }) || [];

  useEffect(() => {
    fetchData();
  }, []);

  // 监听滚动事件以显示/隐藏返回顶部按钮
  useEffect(() => {
    const getScrollTop = () => {
      return document.body.scrollTop || document.documentElement.scrollTop || 0;
    };

    // 滚动事件处理
    const handleScroll = () => {
      const scrollTop = getScrollTop();
      setShowBackToTop(scrollTop > 300);
    };

    // 监听 body 元素的滚动事件（参考play-stats页面的实现方式）
    document.body.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      document.body.removeEventListener('scroll', handleScroll);
    };
  }, []);

  // 返回顶部功能
  const scrollToTop = () => {
    try {
      // 根据play-stats页面的实现，真正的滚动容器是 document.body
      document.body.scrollTo({
        top: 0,
        behavior: 'smooth',
      });
    } catch (e) {
      // 降级方案
      document.body.scrollTop = 0;
      document.documentElement.scrollTop = 0;
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const getTypeIcon = (type: 'movie' | 'tv') => {
    return type === 'movie' ? <Film className="w-4 h-4" /> : <Tv className="w-4 h-4" />;
  };

  const getTypeLabel = (type: 'movie' | 'tv') => {
    return type === 'movie' ? '电影' : '电视剧';
  };

  return (
    <PageLayout activePath="/release-calendar">
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* 页面标题 */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <Calendar className="w-8 h-8 text-blue-600" />
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">影视上映日程</h1>
          </div>
          <p className="text-gray-600 dark:text-gray-400">
            探索即将上映的电影和电视剧，不错过任何精彩内容
          </p>
        </div>

        {/* 过滤器区域 */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            {/* 类型过滤 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">类型</label>
              <select
                value={filters.type}
                onChange={(e) => setFilters(prev => ({ ...prev, type: e.target.value as 'movie' | 'tv' | '' }))}
                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                <option value="">全部</option>
                {data?.filters.types.map(type => (
                  <option key={type.value} value={type.value}>
                    {type.label} ({type.count})
                  </option>
                ))}
              </select>
            </div>

            {/* 地区过滤 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">地区</label>
              <select
                value={filters.region}
                onChange={(e) => setFilters(prev => ({ ...prev, region: e.target.value }))}
                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                <option value="">全部</option>
                {data?.filters.regions.map(region => (
                  <option key={region.value} value={region.value}>
                    {region.label} ({region.count})
                  </option>
                ))}
              </select>
            </div>

            {/* 类型标签过滤 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">类型标签</label>
              <select
                value={filters.genre}
                onChange={(e) => setFilters(prev => ({ ...prev, genre: e.target.value }))}
                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                <option value="">全部</option>
                {data?.filters.genres.map(genre => (
                  <option key={genre.value} value={genre.value}>
                    {genre.label} ({genre.count})
                  </option>
                ))}
              </select>
            </div>

            {/* 搜索框 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">搜索</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-gray-500 w-4 h-4" />
                <input
                  type="text"
                  placeholder="搜索标题、导演、演员..."
                  value={filters.search}
                  onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
                  className="w-full pl-10 p-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
                />
              </div>
            </div>
          </div>

          {/* 日期范围过滤 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">开始日期</label>
              <input
                type="date"
                value={filters.dateFrom}
                onChange={(e) => setFilters(prev => ({ ...prev, dateFrom: e.target.value }))}
                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">结束日期</label>
              <input
                type="date"
                value={filters.dateTo}
                onChange={(e) => setFilters(prev => ({ ...prev, dateTo: e.target.value }))}
                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="flex flex-wrap gap-3">
            <button
              onClick={applyFilters}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 dark:bg-blue-700 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Filter className="w-4 h-4" />
              应用过滤器
            </button>
            <button
              onClick={resetFilters}
              className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
            >
              重置
            </button>
            <button
              onClick={handleRefreshClick}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 dark:bg-green-700 text-white rounded-lg hover:bg-green-700 dark:hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
              </svg>
              <span>{loading ? '刷新中...' : '刷新数据'}</span>
            </button>
            <div className="flex items-center gap-2 ml-auto">
              <button
                onClick={() => setViewMode('grid')}
                className={`px-3 py-2 rounded-lg transition-colors ${
                  viewMode === 'grid'
                    ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                网格视图
              </button>
              <button
                onClick={() => setViewMode('timeline')}
                className={`px-3 py-2 rounded-lg transition-colors ${
                  viewMode === 'timeline'
                    ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                时间线视图
              </button>
            </div>
          </div>
        </div>

        {/* 加载状态 */}
        {loading && !data && (
          <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        )}

        {/* 错误状态 */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-6">
            <p className="text-red-700 dark:text-red-400">错误: {error}</p>
          </div>
        )}

        {/* 数据展示 */}
        {data && (
          <>
            {/* 统计信息 */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 mb-6">
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  共找到 <span className="font-semibold text-gray-900 dark:text-white">{data.total}</span> 条记录
                  {filteredItems.length !== data.items.length && (
                    <span>，当前显示 <span className="font-semibold text-gray-900 dark:text-white">{filteredItems.length}</span> 条</span>
                  )}
                </div>
              </div>
            </div>

            {/* 网格视图 */}
            {viewMode === 'grid' && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {currentItems.map((item) => (
                  <div key={item.id} className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden hover:shadow-md transition-shadow">
                    <div className="p-6">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-2">
                          {getTypeIcon(item.type)}
                          <span className="text-sm text-gray-600 dark:text-gray-400">{getTypeLabel(item.type)}</span>
                        </div>
                        <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                          <Clock className="w-3 h-3" />
                          {formatDate(item.releaseDate)}
                        </div>
                      </div>

                      <h3 className="font-semibold text-gray-900 dark:text-white mb-2 line-clamp-2">
                        {item.title}
                      </h3>

                      <div className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                        <div>
                          <span className="font-medium">导演:</span> {item.director}
                        </div>
                        <div>
                          <span className="font-medium">主演:</span> {item.actors}
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            <span>{item.region}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Tag className="w-3 h-3" />
                            <span>{item.genre}</span>
                          </div>
                        </div>
                        {item.episodes && (
                          <div>
                            <span className="font-medium">集数:</span> {item.episodes}集
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 时间线视图 */}
            {viewMode === 'timeline' && (
              <div className="space-y-4">
                {Object.entries(
                  currentItems.reduce((acc, item) => {
                    const date = item.releaseDate;
                    if (!acc[date]) acc[date] = [];
                    acc[date].push(item);
                    return acc;
                  }, {} as Record<string, ReleaseCalendarItem[]>)
                ).sort(([a], [b]) => a.localeCompare(b)).map(([date, items]) => (
                  <div key={date} className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                    <div className="bg-gray-50 dark:bg-gray-700 px-6 py-3 border-b border-gray-200 dark:border-gray-600">
                      <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                        <Calendar className="w-4 h-4" />
                        {formatDate(date)}
                        <span className="text-sm text-gray-500 dark:text-gray-400">({items.length} 部)</span>
                      </h3>
                    </div>
                    <div className="p-6">
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {items.map((item) => (
                          <div key={item.id} className="border border-gray-100 dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-800">
                            <div className="flex items-start justify-between mb-2">
                              <h4 className="font-medium text-gray-900 dark:text-white">{item.title}</h4>
                              <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                                {getTypeIcon(item.type)}
                                <span>{getTypeLabel(item.type)}</span>
                              </div>
                            </div>
                            <div className="space-y-1 text-sm text-gray-600 dark:text-gray-400">
                              <div>导演: {item.director}</div>
                              <div>主演: {item.actors}</div>
                              <div className="flex items-center gap-4">
                                <span>{item.region}</span>
                                <span>{item.genre}</span>
                              </div>
                              {item.episodes && <div>{item.episodes}集</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 分页导航 */}
            {totalPages > 1 && (
              <div className="flex justify-center mt-8 space-x-2">
                <button
                  onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                  disabled={currentPage === 1}
                  className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors"
                >
                  上一页
                </button>
                <span className="px-4 py-2 text-gray-600 dark:text-gray-400">
                  第 {currentPage} 页，共 {totalPages} 页
                </span>
                <button
                  onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                  disabled={currentPage === totalPages}
                  className="px-4 py-2 bg-blue-600 dark:bg-blue-700 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 disabled:opacity-50 transition-colors"
                >
                  下一页
                </button>
              </div>
            )}

            {/* 无数据 */}
            {currentItems.length === 0 && !loading && (
              <div className="text-center py-12">
                <div className="text-gray-400 dark:text-gray-600 mb-4">
                  <Calendar className="w-16 h-16 mx-auto" />
                </div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">暂无数据</h3>
                <p className="text-gray-500 dark:text-gray-400">
                  没有找到符合条件的影视作品，请尝试调整过滤条件
                </p>
              </div>
            )}
          </>
        )}

        {/* 返回顶部悬浮按钮 */}
        {showBackToTop && (
          <button
            onClick={scrollToTop}
            className="fixed bottom-6 right-6 z-50 group bg-blue-600 dark:bg-blue-700 text-white p-3 rounded-full shadow-lg hover:bg-blue-700 dark:hover:bg-blue-600 transition-all duration-300 hover:scale-110"
            aria-label="返回顶部"
          >
            <ChevronUp className="w-6 h-6 transition-transform group-hover:scale-110" />
          </button>
        )}
      </div>
      </div>
    </PageLayout>
  );
}