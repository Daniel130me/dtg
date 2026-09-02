'use client';

import React from 'react';
import Link from 'next/link';
import { GraduationCap, Mail, MapPin, Phone, Twitter, Linkedin, Youtube, Globe } from 'lucide-react';
import { useNav } from '@/lib/prototype/navigation';
import { FOOTER_CATEGORY_LINKS } from '@/content/site';
import { Separator } from '@/components/ui/separator';

const quickLinks = [
  { label: 'Home', view: 'home' },
  { label: 'All Courses', view: 'courses' },
  { label: 'About Instructor', view: 'about' },
  { label: 'Contact Us', view: 'contact' },
];

/** Real catalog slugs (src/content/site.ts) so each link lands pre-filtered. */
const categoryLinks = FOOTER_CATEGORY_LINKS;

export default function Footer() {
  const { navigate } = useNav();

  return (
    <footer className='mt-auto border-t bg-muted/30'>
      <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-28 md:pb-12 lg:pt-16 lg:pb-16'>
        {/* Extra bottom padding on phones clears the fixed bottom navigation bar. */}
        <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-12'>
          {/* Brand */}
          <div className='sm:col-span-2 lg:col-span-1'>
            <button onClick={() => navigate('home')} className='flex items-center gap-2 mb-4 hover:opacity-80 transition-opacity'>
              <div className='size-9 rounded-lg bg-primary flex items-center justify-center'>
                <GraduationCap className='size-5 text-primary-foreground' />
              </div>
              <span className='text-xl font-bold tracking-tight text-foreground'>DTG</span>
            </button>
            <p className='text-sm text-muted-foreground leading-relaxed mb-5'>
              Empowering the next generation of tech professionals with practical, project-based learning experiences.
            </p>
            <div className='flex items-center gap-3'>
              <a href='#' className='size-9 rounded-full bg-muted flex items-center justify-center hover:bg-primary hover:text-primary-foreground transition-colors text-muted-foreground'>
                <Twitter className='size-4' />
              </a>
              <a href='#' className='size-9 rounded-full bg-muted flex items-center justify-center hover:bg-primary hover:text-primary-foreground transition-colors text-muted-foreground'>
                <Linkedin className='size-4' />
              </a>
              <a href='#' className='size-9 rounded-full bg-muted flex items-center justify-center hover:bg-primary hover:text-primary-foreground transition-colors text-muted-foreground'>
                <Youtube className='size-4' />
              </a>
              <a href='#' className='size-9 rounded-full bg-muted flex items-center justify-center hover:bg-primary hover:text-primary-foreground transition-colors text-muted-foreground'>
                <Globe className='size-4' />
              </a>
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className='font-semibold text-sm mb-4 text-foreground'>Quick Links</h3>
            <ul className='space-y-2.5'>
              {quickLinks.map((link) => (
                <li key={link.view}>
                  <button
                    onClick={() => navigate(link.view as any)}
                    className='text-sm text-muted-foreground hover:text-primary transition-colors'
                  >
                    {link.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Categories */}
          <div>
            <h3 className='font-semibold text-sm mb-4 text-foreground'>Categories</h3>
            <ul className='space-y-2.5'>
              {categoryLinks.map((cat) => (
                <li key={cat.slug}>
                  <Link
                    href={`/courses?category=${cat.slug}`}
                    className='text-sm text-muted-foreground hover:text-primary transition-colors'
                  >
                    {cat.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact Info */}
          <div>
            <h3 className='font-semibold text-sm mb-4 text-foreground'>Contact</h3>
            <ul className='space-y-3'>
              <li className='flex items-start gap-2.5 text-sm text-muted-foreground'>
                <Mail className='size-4 mt-0.5 shrink-0 text-primary' />
                <span>hello@dtg.dev</span>
              </li>
              <li className='flex items-start gap-2.5 text-sm text-muted-foreground'>
                <Phone className='size-4 mt-0.5 shrink-0 text-primary' />
                <span>+234 801 234 5678</span>
              </li>
              <li className='flex items-start gap-2.5 text-sm text-muted-foreground'>
                <MapPin className='size-4 mt-0.5 shrink-0 text-primary' />
                <span>Lagos, Nigeria</span>
              </li>
            </ul>
          </div>
        </div>

        <Separator className='my-8' />

        <div className='flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground'>
          <p>&copy; {new Date().getFullYear()} DTG. All rights reserved.</p>
          <div className='flex items-center gap-4'>
            <button className='hover:text-primary transition-colors'>Privacy Policy</button>
            <button className='hover:text-primary transition-colors'>Terms of Service</button>
            <button className='hover:text-primary transition-colors'>Cookie Policy</button>
          </div>
        </div>
      </div>
    </footer>
  );
}