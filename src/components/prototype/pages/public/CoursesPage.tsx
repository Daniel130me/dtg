'use client';

import React, { useState, useMemo } from 'react';
import { Search, SlidersHorizontal } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import CourseCard from '@/components/prototype/shared/CourseCard';
import { useNav } from '@/lib/prototype/navigation';
import { courses, categories } from '@/lib/prototype/mock-data';

const sortOptions = [
  { value: 'popular', label: 'Most Popular' },
  { value: 'newest', label: 'Newest' },
  { value: 'price-low', label: 'Price: Low to High' },
  { value: 'price-high', label: 'Price: High to Low' },
  { value: 'rating', label: 'Highest Rated' },
];

export default function CoursesPage() {
  const { navigate } = useNav();
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [sort, setSort] = useState('popular');

  const filteredCourses = useMemo(() => {
    let result = courses.filter(c => c.isPublished);

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(c =>
        c.title.toLowerCase().includes(q) ||
        c.shortDescription.toLowerCase().includes(q) ||
        c.categoryName.toLowerCase().includes(q)
      );
    }

    if (selectedCategory !== 'all') {
      result = result.filter(c => c.categoryId === selectedCategory);
    }

    switch (sort) {
      case 'popular':
        result.sort((a, b) => b.studentsEnrolled - a.studentsEnrolled);
        break;
      case 'newest':
        result.sort((a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime());
        break;
      case 'price-low':
        result.sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
        break;
      case 'price-high':
        result.sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
        break;
      case 'rating':
        result.sort((a, b) => b.rating - a.rating);
        break;
    }

    return result;
  }, [search, selectedCategory, sort]);

  return (
    <main className='flex-1'>
      {/* Page Header */}
      <section className='bg-muted/30 border-b'>
        <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14'>
          <h1 className='text-2xl sm:text-3xl font-bold mb-2'>Explore Courses</h1>
          <p className='text-muted-foreground max-w-xl'>Discover our comprehensive library of courses designed to help you master in-demand tech skills.</p>
        </div>
      </section>

      <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8'>
        {/* Search & Filters */}
        <div className='flex flex-col sm:flex-row gap-4 mb-6'>
          <div className='relative flex-1'>
            <Search className='absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground' />
            <Input
              placeholder='Search courses...'
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className='pl-9 h-10'
            />
          </div>
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className='w-full sm:w-48'>
              <SlidersHorizontal className='size-4 mr-1.5' />
              <SelectValue placeholder='Sort by' />
            </SelectTrigger>
            <SelectContent>
              {sortOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Category Pills */}
        <div className='flex flex-wrap gap-2 mb-8'>
          <button
            onClick={() => setSelectedCategory('all')}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
              selectedCategory === 'all'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-accent'
            }`}
          >
            All Courses
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                selectedCategory === cat.id
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent'
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>

        {/* Results Count */}
        <p className='text-sm text-muted-foreground mb-6'>
          Showing <span className='font-medium text-foreground'>{filteredCourses.length}</span>{' '}
          {filteredCourses.length === 1 ? 'course' : 'courses'}
          {selectedCategory !== 'all' && (
            <>
              {' '}in <span className='font-medium text-primary'>{categories.find(c => c.id === selectedCategory)?.name}</span>
            </>
          )}
        </p>

        {/* Course Grid */}
        {filteredCourses.length > 0 ? (
          <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6'>
            {filteredCourses.map((course) => (
              <CourseCard
                key={course.id}
                course={course}
                onCourseClick={(id) => navigate('course-detail', { courseId: id })}
              />
            ))}
          </div>
        ) : (
          <div className='text-center py-20'>
            <div className='size-16 mx-auto rounded-full bg-muted flex items-center justify-center mb-4'>
              <Search className='size-7 text-muted-foreground' />
            </div>
            <h3 className='font-semibold text-lg mb-1'>No courses found</h3>
            <p className='text-sm text-muted-foreground mb-4'>Try adjusting your search or filter criteria.</p>
            <Button variant='outline' onClick={() => { setSearch(''); setSelectedCategory('all'); }}>
              Clear Filters
            </Button>
          </div>
        )}
      </section>
    </main>
  );
}
