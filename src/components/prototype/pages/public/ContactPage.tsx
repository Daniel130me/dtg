'use client';

import React, { useState } from 'react';
import { Mail, Phone, MapPin, Send, Clock, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useNav } from '@/lib/prototype/navigation';

export default function ContactPage() {
  const { navigate } = useNav();
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setTimeout(() => setSubmitted(false), 3000);
  };

  return (
    <main className='flex-1'>
      {/* Header */}
      <section className='bg-muted/30 border-b'>
        <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14'>
          <Badge variant='secondary' className='mb-3'>Get in Touch</Badge>
          <h1 className='text-2xl sm:text-3xl font-bold mb-2'>Contact Us</h1>
          <p className='text-muted-foreground max-w-xl'>Have a question, suggestion, or just want to say hello? We'd love to hear from you.</p>
        </div>
      </section>

      <section className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12'>
        <div className='grid lg:grid-cols-3 gap-8'>
          {/* Contact Form */}
          <div className='lg:col-span-2'>
            <Card className='p-6 sm:p-8 gap-6'>
              <h2 className='text-lg font-bold'>Send us a message</h2>
              {submitted ? (
                <div className='text-center py-12'>
                  <div className='mx-auto size-14 rounded-full bg-blue-100 flex items-center justify-center mb-4'>
                    <Send className='size-6 text-blue-600' />
                  </div>
                  <h3 className='font-semibold text-lg mb-1'>Message Sent!</h3>
                  <p className='text-sm text-muted-foreground'>We'll get back to you within 24 hours.</p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className='space-y-5'>
                  <div className='grid sm:grid-cols-2 gap-4'>
                    <div className='space-y-2'>
                      <Label htmlFor='name'>Full Name</Label>
                      <Input id='name' placeholder='John Doe' required />
                    </div>
                    <div className='space-y-2'>
                      <Label htmlFor='email'>Email Address</Label>
                      <Input id='email' type='email' placeholder='john@example.com' required />
                    </div>
                  </div>
                  <div className='space-y-2'>
                    <Label htmlFor='subject'>Subject</Label>
                    <Input id='subject' placeholder='What is this about?' required />
                  </div>
                  <div className='space-y-2'>
                    <Label htmlFor='message'>Message</Label>
                    <Textarea id='message' placeholder='Tell us more...' rows={6} required className='resize-none' />
                  </div>
                  <Button type='submit' size='lg' className='w-full sm:w-auto'>
                    <Send className='size-4 mr-2' /> Send Message
                  </Button>
                </form>
              )}
            </Card>
          </div>

          {/* Sidebar */}
          <div className='space-y-6'>
            <Card className='p-6 gap-5'>
              <h3 className='font-semibold mb-1'>Contact Information</h3>
              <p className='text-sm text-muted-foreground mb-4'>Reach out through any of the channels below.</p>
              <div className='space-y-4'>
                <div className='flex items-start gap-3'>
                  <div className='size-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0'>
                    <Mail className='size-4' />
                  </div>
                  <div>
                    <p className='text-sm font-medium'>Email</p>
                    <p className='text-sm text-muted-foreground'>hello@dtg.dev</p>
                  </div>
                </div>
                <div className='flex items-start gap-3'>
                  <div className='size-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0'>
                    <Phone className='size-4' />
                  </div>
                  <div>
                    <p className='text-sm font-medium'>Phone</p>
                    <p className='text-sm text-muted-foreground'>+234 801 234 5678</p>
                  </div>
                </div>
                <div className='flex items-start gap-3'>
                  <div className='size-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0'>
                    <MapPin className='size-4' />
                  </div>
                  <div>
                    <p className='text-sm font-medium'>Location</p>
                    <p className='text-sm text-muted-foreground'>Lagos, Nigeria</p>
                  </div>
                </div>
                <div className='flex items-start gap-3'>
                  <div className='size-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0'>
                    <Clock className='size-4' />
                  </div>
                  <div>
                    <p className='text-sm font-medium'>Working Hours</p>
                    <p className='text-sm text-muted-foreground'>Mon - Fri, 9AM - 6PM WAT</p>
                  </div>
                </div>
              </div>
            </Card>

            <Card className='p-6 gap-4'>
              <div className='flex items-start gap-3'>
                <div className='size-9 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-600 shrink-0'>
                  <MessageSquare className='size-4' />
                </div>
                <div>
                  <p className='text-sm font-semibold mb-1'>Need Quick Help?</p>
                  <p className='text-xs text-muted-foreground leading-relaxed'>Check our FAQ section for instant answers to common questions.</p>
                </div>
              </div>
            </Card>
          </div>
        </div>

        {/* Map Placeholder */}
        <div className='mt-10 rounded-xl border overflow-hidden'>
          <div className='h-64 sm:h-80 bg-gradient-to-br from-blue-50 to-blue-100 flex items-center justify-center relative'>
            <div className='absolute inset-0 opacity-20'>
              <div className='w-full h-full' style={{ backgroundImage: 'radial-gradient(circle, oklch(0.432 0.095 166 / 0.15) 1px, transparent 1px)', backgroundSize: '24px 24px' }} />
            </div>
            <div className='relative text-center'>
              <MapPin className='size-8 text-primary mx-auto mb-2' />
              <p className='font-semibold text-sm'>Lagos, Nigeria</p>
              <p className='text-xs text-muted-foreground'>Interactive map placeholder</p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
