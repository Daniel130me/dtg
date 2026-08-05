'use client';

import React from 'react';
import { motion } from 'framer-motion';
import {
  Award,
  Download,
  ExternalLink,
  Calendar,
  ShieldCheck,
  Copy,
  CheckCircle2,
  BookOpen,
} from 'lucide-react';
import { useNav } from '@/lib/prototype/navigation';
import { certificates } from '@/lib/prototype/mock-data';
import StudentLayout from '@/components/prototype/layout/StudentLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

export default function CertificatesPage() {
  const { navigate } = useNav();

  return (
    <StudentLayout>
      <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        {/* Page Header */}
        <div>
          <h1 className="text-2xl font-bold">Certificates</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Your earned certificates and credentials
          </p>
        </div>

        {certificates.length === 0 ? (
          /* Empty State */
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-20 text-center">
              <div className="size-20 rounded-2xl bg-amber-500/10 flex items-center justify-center">
                <Award className="size-10 text-amber-500/50" />
              </div>
              <h3 className="text-lg font-semibold mt-4">No Certificates Yet</h3>
              <p className="text-sm text-muted-foreground mt-1.5 max-w-sm">
                Complete a course to earn your first certificate. Keep learning and achieve your goals!
              </p>
              <Button className="mt-6" onClick={() => navigate('courses')}>
                <BookOpen className="size-4 mr-2" />
                Browse Courses
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid md:grid-cols-2 gap-6">
            {certificates.map((cert, idx) => (
              <motion.div
                key={cert.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.1, duration: 0.4 }}
              >
                <CertificateCard certificate={cert} />
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </StudentLayout>
  );
}

function CertificateCard({
  certificate,
}: {
  certificate: {
    id: string;
    courseName: string;
    completedAt: string;
    certificateId: string;
    verificationCode: string;
  };
}) {
  return (
    <Card className="overflow-hidden">
      {/* Certificate Preview Header */}
      <div className="relative bg-gradient-to-br from-amber-400 via-amber-500 to-orange-500 p-6 sm:p-8 text-white">
        <div className="absolute top-0 right-0 w-48 h-48 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2" />
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-3">
            <div className="size-10 rounded-xl bg-white/20 flex items-center justify-center">
              <Award className="size-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-white/70">Certificate of Completion</p>
              <p className="text-sm font-bold">DTG Academy</p>
            </div>
          </div>
          <h3 className="text-lg sm:text-xl font-bold line-clamp-2 leading-snug">
            {certificate.courseName}
          </h3>
          <p className="text-sm text-white/80 mt-2">
            This certifies successful completion of the course
          </p>
        </div>
      </div>

      {/* Certificate Details */}
      <CardContent className="p-4 sm:p-6 space-y-4">
        {/* Info rows */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="size-4" />
              Completion Date
            </div>
            <span className="text-sm font-medium">{certificate.completedAt}</span>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Award className="size-4" />
              Certificate ID
            </div>
            <Badge variant="outline" className="font-mono text-xs">
              {certificate.certificateId}
            </Badge>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <ShieldCheck className="size-4" />
              Verification Code
            </div>
            <div className="flex items-center gap-1.5">
              <code className="text-xs bg-muted px-2 py-1 rounded font-mono">
                {certificate.verificationCode}
              </code>
              <Button variant="ghost" size="icon" className="size-7 shrink-0">
                <Copy className="size-3.5" />
              </Button>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <Button className="flex-1 gap-2" size="sm">
            <Download className="size-4" />
            Download
          </Button>
          <Button variant="outline" className="flex-1 gap-2" size="sm">
            <ExternalLink className="size-4" />
            View Certificate
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}