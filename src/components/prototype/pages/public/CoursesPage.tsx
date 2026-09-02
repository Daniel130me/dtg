'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, Search, SlidersHorizontal, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import CourseCard from '@/components/prototype/shared/CourseCard';
import { CourseCardSkeleton, FetchErrorState } from '@/components/prototype/shared/AsyncStates';
import { fetchCategories, fetchCourses, type CourseListQueryInput } from '@/features/catalog/api';
import { formatLevel } from '@/lib/client/format';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  COURSE_PAGE_LIMIT_DEFAULT,
  COURSE_PRICE_FILTERS,
  COURSE_SORTS,
  type CategoryDto,
  type CourseLevel,
  type CourseListItemDto,
  type CourseSortKey,
} from '@/contracts/catalog';

/** How long to wait after the last keystroke before committing the search to the URL. */
const SEARCH_DEBOUNCE_MS = 300;

/** Page-level default sort (kept from the prototype; the API default is NEWEST). */
const DEFAULT_SORT: CourseSortKey = 'POPULAR';

const SENTINEL_ALL = 'ALL';

const sortOptions: { value: CourseSortKey; label: string }[] = [
  { value: 'POPULAR', label: 'Most Popular' },
  { value: 'NEWEST', label: 'Newest' },
  { value: 'PRICE_ASC', label: 'Price: Low to High' },
  { value: 'PRICE_DESC', label: 'Price: High to Low' },
  { value: 'RATING', label: 'Highest Rated' },
];

const priceOptions: { value: string; label: string }[] = [
  { value: SENTINEL_ALL, label: 'All Prices' },
  { value: 'FREE', label: 'Free' },
  { value: 'PAID', label: 'Paid' },
];

/** Returns the value when it is one of the allowed enum members, otherwise undefined. */
function parseEnumParam<T extends readonly string[]>(
  allowed: T,
  value: string | null,
): T[number] | undefined {
  return value !== null && (allowed as readonly string[]).includes(value)
    ? (value as T[number])
    : undefined;
}

function CoursesPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // --- Filters live in the URL -------------------------------------------
  const urlSearch = searchParams.get('search') ?? '';
  const urlCategory = searchParams.get('category') ?? '';
  const urlLevel = searchParams.get('level') || undefined;
  const urlPriceRaw = parseEnumParam(COURSE_PRICE_FILTERS, searchParams.get('price'));
  const urlPrice = urlPriceRaw === SENTINEL_ALL ? undefined : urlPriceRaw;
  const urlSort = parseEnumParam(COURSE_SORTS, searchParams.get('sort')) ?? DEFAULT_SORT;

  const [searchInput, setSearchInput] = useState(urlSearch);
  const [lastUrlSearch, setLastUrlSearch] = useState(urlSearch);
  if (lastUrlSearch !== urlSearch) {
    setLastUrlSearch(urlSearch);
    setSearchInput(urlSearch);
  }

  const [items, setItems] = useState<CourseListItemDto[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [retrySeed, setRetrySeed] = useState(0);

  // Loading is DERIVED from comparing the settled request key against the key
  // implied by the current URL filters (see HomePage) — effects only touch
  // state inside async callbacks, avoiding cascading synchronous setStates.
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const requestKey = `${urlSearch}|${urlCategory}|${urlLevel ?? ''}|${urlPrice ?? ''}|${urlSort}|${retrySeed}`;
  const loading = loadedKey !== requestKey;

  const [categories, setCategories] = useState<CategoryDto[] | null>(null);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [categoriesLoadedKey, setCategoriesLoadedKey] = useState<string | null>(null);
  const [categoriesRetrySeed, setCategoriesRetrySeed] = useState(0);
  const categoriesKey = `categories#${categoriesRetrySeed}`;
  const categoriesLoading = categoriesLoadedKey !== categoriesKey;

  /** Replace one or more query params; removes empty values and skips no-op updates. */
  const updateParams = useCallback(
    (updates: Record<string, string | undefined>) => {
      const params = new URLSearchParams(searchParams.toString());
      let changed = false;
      for (const [key, value] of Object.entries(updates)) {
        const current = params.get(key) ?? undefined;
        if (value === current) continue;
        changed = true;
        if (value) params.set(key, value);
        else params.delete(key);
      }
      if (!changed) return;
      const queryString = params.toString();
      router.replace(queryString ? `/courses?${queryString}` : '/courses', { scroll: false });
    },
    [router, searchParams],
  );

  // Commit the debounced search input to the URL.
  useEffect(() => {
    const timer = setTimeout(() => {
      updateParams({ search: searchInput.trim() || undefined });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput, updateParams]);

  // Categories for the filter pills.
  useEffect(() => {
    let cancelled = false;
    fetchCategories()
      .then((cats) => {
        if (cancelled) return;
        setCategories(cats);
        setCategoriesError(null);
        setCategoriesLoadedKey(categoriesKey);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setCategoriesError(err instanceof Error ? err.message : 'Failed to load categories.');
        setCategoriesLoadedKey(categoriesKey);
      });
    return () => {
      cancelled = true;
    };
  }, [categoriesKey]);

  // API query derived from the URL; drives the main fetch.
  const apiQuery = useMemo<CourseListQueryInput>(
    () => ({
      search: urlSearch || undefined,
      category: urlCategory || undefined,
      level: urlLevel,
      price: urlPrice,
      sort: urlSort,
      limit: COURSE_PAGE_LIMIT_DEFAULT,
    }),
    [urlSearch, urlCategory, urlLevel, urlPrice, urlSort],
  );

  // Re-fetch page 1 whenever the query (or a retry) happens.
  useEffect(() => {
    let cancelled = false;
    fetchCourses(apiQuery)
      .then((res) => {
        if (cancelled) return;
        setItems(res.items);
        setTotal(res.total);
        setNextCursor(res.nextCursor);
        setError(null);
        setLoadMoreError(null);
        setLoadedKey(requestKey);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load courses.');
        setLoadedKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [apiQuery, requestKey]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const res = await fetchCourses({ ...apiQuery, cursor: nextCursor });
      setItems((prev) => [...prev, ...res.items]);
      setNextCursor(res.nextCursor);
    } catch (err: unknown) {
      setLoadMoreError(err instanceof Error ? err.message : 'Failed to load more courses.');
    } finally {
      setLoadingMore(false);
    }
  }, [apiQuery, nextCursor, loadingMore]);

  const clearFilters = useCallback(() => {
    setSearchInput('');
    updateParams({ search: undefined, category: undefined, level: undefined, price: undefined });
  }, [updateParams]);

  const isMobile = useIsMobile();
  const [filtersOpen, setFiltersOpen] = useState(false);

  const activeCategoryName = (categories ?? []).find((c) => c.slug === urlCategory)?.name;

  // Active non-sort filters, derived from the same URL state that drives the
  // query — the mobile chips and the Filters badge are pure projections.
  const activeFilters = useMemo(() => {
    const chips: { key: string; label: string; clear: () => void }[] = [];
    if (urlSearch) {
      chips.push({
        key: 'search',
        label: `Search: ${urlSearch}`,
        clear: () => {
          setSearchInput('');
          updateParams({ search: undefined });
        },
      });
    }
    if (activeCategoryName) {
      chips.push({ key: 'category', label: activeCategoryName, clear: () => updateParams({ category: undefined }) });
    }
    if (urlLevel) {
      chips.push({ key: 'level', label: formatLevel(urlLevel), clear: () => updateParams({ level: undefined }) });
    }
    if (urlPrice) {
      chips.push({ key: 'price', label: urlPrice === 'FREE' ? 'Free' : 'Paid', clear: () => updateParams({ price: undefined }) });
    }
    return chips;
  }, [urlSearch, activeCategoryName, urlLevel, urlPrice, updateParams]);
  const activeFilterCount = activeFilters.length;

  // --- Shared filter controls ----------------------------------------------
  // The SAME state drives both layouts: the desktop inline bar and the mobile
  // vaul drawer render the same elements (Radix elements are reusable
  // descriptors), so query semantics never diverge.
  const categoryPills = (
    <>
      <button
        onClick={() => updateParams({ category: undefined })}
        className={`inline-flex min-h-11 items-center px-4 rounded-full text-sm font-medium transition-colors ${
          urlCategory === ''
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-muted-foreground hover:bg-accent'
        }`}
      >
        All Courses
      </button>
      {categoriesLoading
        ? Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className='h-11 w-32 rounded-full' />
          ))
        : (categories ?? []).map((cat) => (
            <button
              key={cat.id}
              onClick={() => updateParams({ category: cat.slug })}
              className={`inline-flex min-h-11 items-center px-4 rounded-full text-sm font-medium transition-colors ${
                urlCategory === cat.slug
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent'
              }`}
            >
              {cat.name}
            </button>
          ))}
      {categoriesError && (
        <button
          onClick={() => setCategoriesRetrySeed((s) => s + 1)}
          className='inline-flex min-h-11 items-center px-4 rounded-full text-sm font-medium bg-muted text-muted-foreground hover:bg-accent transition-colors'
        >
          Couldn&apos;t load categories — retry
        </button>
      )}
    </>
  );

  const levelSelect = (
    <Select
      value={urlLevel ?? SENTINEL_ALL}
      onValueChange={(value) => updateParams({ level: value === SENTINEL_ALL ? undefined : value })}
    >
      <SelectTrigger className='w-full sm:w-40 h-11 md:h-10' aria-label='Level filter'>
        <SelectValue placeholder='Level' />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={SENTINEL_ALL}>All Levels</SelectItem>
        {['BEGINNER', 'INTERMEDIATE', 'ADVANCED'].map((level) => (
          <SelectItem key={level} value={level}>{formatLevel(level)}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const priceSelect = (
    <Select
      value={urlPriceRaw ?? SENTINEL_ALL}
      onValueChange={(value) => updateParams({ price: value === SENTINEL_ALL ? undefined : value })}
    >
      <SelectTrigger className='w-full sm:w-36 h-11 md:h-10' aria-label='Price filter'>
        <SelectValue placeholder='Price' />
      </SelectTrigger>
      <SelectContent>
        {priceOptions.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const sortSelect = (
    <Select value={urlSort} onValueChange={(value) => updateParams({ sort: value === DEFAULT_SORT ? undefined : value })}>
      <SelectTrigger className='w-full sm:w-48 h-11 md:h-10' aria-label='Sort courses'>
        <SlidersHorizontal className='size-4 mr-1.5' />
        <SelectValue placeholder='Sort by' />
      </SelectTrigger>
      <SelectContent>
        {sortOptions.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <main className='flex-1'>
      {/* Page Header */}
      <section className='bg-muted/30 border-b'>
        <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14'>
          <h1 className='text-2xl sm:text-3xl font-bold mb-2'>Explore Courses</h1>
          <p className='text-muted-foreground max-w-xl'>Discover our comprehensive library of courses designed to help you master in-demand tech skills.</p>
        </div>
      </section>

      {/* Sticky mobile action row: search + Filters entry point (md:hidden).
          Sits flush under the sticky header (h-16 + safe-area inset). */}
      <div
        className='md:hidden sticky z-30 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b'
        style={{ top: 'calc(4rem + env(safe-area-inset-top, 0px))' }}
      >
        <div className='flex items-center gap-2 px-4 py-2.5'>
          <div className='relative flex-1'>
            <Search className='absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground' />
            <Input
              type='search'
              placeholder='Search courses...'
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className='pl-9 h-11'
            />
          </div>
          <Button
            variant='outline'
            onClick={() => setFiltersOpen(true)}
            className='min-h-11 shrink-0 gap-1.5 px-3'
            aria-label={`Filters${activeFilterCount > 0 ? ` (${activeFilterCount} active)` : ''}`}
          >
            <SlidersHorizontal className='size-4' />
            Filters
            {activeFilterCount > 0 && (
              <span className='inline-flex min-w-5 size-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold leading-none text-primary-foreground'>
                {activeFilterCount}
              </span>
            )}
          </Button>
        </div>
        {/* Removable active-filter chips (mobile only; the desktop bar shows every filter inline) */}
        {activeFilters.length > 0 && (
          <div className='flex items-center gap-2 overflow-x-auto px-4 pb-2.5'>
            {activeFilters.map((chip) => (
              <button
                key={chip.key}
                onClick={chip.clear}
                className='inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full bg-muted pl-3 pr-2 text-xs font-medium text-foreground transition-colors hover:bg-accent'
                aria-label={`Remove filter: ${chip.label}`}
              >
                {chip.label}
                <X className='size-3.5 text-muted-foreground' />
              </button>
            ))}
            <button
              onClick={clearFilters}
              className='inline-flex min-h-8 shrink-0 items-center px-2 text-xs font-semibold text-primary transition-colors hover:text-primary/80'
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      {/* Mobile filters drawer (vaul): same state as the desktop inline bar. */}
      {isMobile && (
        <Drawer direction='bottom' open={filtersOpen} onOpenChange={setFiltersOpen}>
          <DrawerContent className='max-h-[85vh]'>
            <DrawerHeader className='text-left'>
              <DrawerTitle>Filters</DrawerTitle>
              <DrawerDescription>Refine the {total} published course{total === 1 ? '' : 's'}.</DrawerDescription>
            </DrawerHeader>
            <div className='overflow-y-auto px-4 pb-2 space-y-5'>
              <div>
                <p className='text-sm font-medium mb-2'>Category</p>
                <div className='flex flex-wrap gap-2'>{categoryPills}</div>
              </div>
              <div className='space-y-4'>
                <div>
                  <p className='text-sm font-medium mb-1.5'>Level</p>
                  {levelSelect}
                </div>
                <div>
                  <p className='text-sm font-medium mb-1.5'>Price</p>
                  {priceSelect}
                </div>
                <div>
                  <p className='text-sm font-medium mb-1.5'>Sort by</p>
                  {sortSelect}
                </div>
              </div>
            </div>
            <DrawerFooter className='flex-row gap-2 pb-[max(1rem,env(safe-area-inset-bottom,0px))]'>
              <Button
                variant='outline'
                className='min-h-11 flex-1'
                onClick={clearFilters}
                disabled={activeFilterCount === 0}
              >
                Clear all
              </Button>
              <Button className='min-h-11 flex-[2]' onClick={() => setFiltersOpen(false)}>
                Show results
              </Button>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      )}

      <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8'>
        {/* Search & Filters — desktop keeps the inline bar exactly as before
            (mobile uses the sticky row + drawer above). */}
        <div className='hidden md:flex flex-row gap-4 mb-6'>
          <div className='relative flex-1'>
            <Search className='absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground' />
            <Input
              placeholder='Search courses...'
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className='pl-9 h-10'
            />
          </div>
          {levelSelect}
          {priceSelect}
          {sortSelect}
        </div>

        {/* Category Pills (real categories from the API) — desktop; mobile
            gets the same pills inside the filters drawer. */}
        <div className='hidden md:flex flex-wrap gap-2 mb-8'>
          {categoryPills}
        </div>

        {/* Results Count */}
        {loading ? (
          <Skeleton className='h-4 w-44 mb-6' />
        ) : (
          <p className='text-sm text-muted-foreground mb-6'>
            Showing <span className='font-medium text-foreground'>{items.length}</span> of{' '}
            <span className='font-medium text-foreground'>{total}</span>{' '}
            {total === 1 ? 'course' : 'courses'}
            {activeCategoryName && (
              <>
                {' '}in <span className='font-medium text-primary'>{activeCategoryName}</span>
              </>
            )}
          </p>
        )}

        {/* Course Grid */}
        {loading ? (
          <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6'>
            {Array.from({ length: COURSE_PAGE_LIMIT_DEFAULT }).map((_, i) => (
              <CourseCardSkeleton key={i} />
            ))}
          </div>
        ) : error ? (
          <FetchErrorState
            title="Couldn't load courses"
            message={error}
            onRetry={() => setRetrySeed((s) => s + 1)}
          />
        ) : items.length > 0 ? (
          <>
            <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6'>
              {items.map((course) => (
                <CourseCard key={course.id} course={course} />
              ))}
            </div>

            {/* Load More */}
            {nextCursor && (
              <div className='text-center mt-10'>
                {loadMoreError && (
                  <p className='text-sm text-destructive mb-3'>{loadMoreError}</p>
                )}
                <Button variant='outline' size='lg' onClick={loadMore} disabled={loadingMore}>
                  {loadingMore && <Loader2 className='size-4 animate-spin' />}
                  {loadingMore ? 'Loading…' : 'Load More Courses'}
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className='text-center py-20'>
            <div className='size-16 mx-auto rounded-full bg-muted flex items-center justify-center mb-4'>
              <Search className='size-7 text-muted-foreground' />
            </div>
            <h3 className='font-semibold text-lg mb-1'>No courses found</h3>
            <p className='text-sm text-muted-foreground mb-4'>Try adjusting your search or filter criteria.</p>
            <Button variant='outline' onClick={clearFilters}>
              Clear Filters
            </Button>
          </div>
        )}
      </section>
    </main>
  );
}

export default function CoursesPage() {
  // useSearchParams needs a Suspense boundary during prerendering.
  return (
    <Suspense
      fallback={
        <main className='flex-1'>
          <section className='bg-muted/30 border-b'>
            <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14'>
              <Skeleton className='h-8 w-56 mb-3' />
              <Skeleton className='h-4 w-full max-w-md' />
            </div>
          </section>
          <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8'>
            <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6'>
              {Array.from({ length: 6 }).map((_, i) => (
                <CourseCardSkeleton key={i} />
              ))}
            </div>
          </section>
        </main>
      }
    >
      <CoursesPageContent />
    </Suspense>
  );
}
