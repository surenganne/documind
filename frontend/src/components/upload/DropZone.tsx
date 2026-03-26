import { motion } from 'framer-motion';
import { Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useDocuments } from '../../hooks/useDocuments';

const ACCEPTED_TYPES = ['.pdf', '.docx', '.txt', '.md'];
const ACCEPTED_MIME = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
];

interface DropZoneProps {
  kb_id: string;
  onUpload?: (files: File[]) => void;
}

export function DropZone({ kb_id, onUpload }: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { uploadFile } = useDocuments();

  const handleFiles = (files: File[]) => {
    const valid = files.filter((f) => ACCEPTED_MIME.includes(f.type));
    if (valid.length === 0) return;
    valid.forEach((f) => uploadFile(f, kb_id));
    onUpload?.(valid);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => setIsDragging(false);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(Array.from(e.dataTransfer.files));
  };

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) handleFiles(Array.from(e.target.files));
    e.target.value = '';
  };

  return (
    <motion.div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
      animate={
        isDragging
          ? { boxShadow: '0 0 0 2px var(--dm-primary), 0 0 16px 4px var(--dm-primary-light)' }
          : { boxShadow: '0 0 0 1px #e2e8f0' }
      }
      transition={{ duration: 0.2 }}
      className="relative flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-200 bg-[var(--dm-surface)] p-10 cursor-pointer hover:bg-[var(--dm-primary-light)] transition-colors"
    >
      <motion.div
        animate={isDragging ? { scale: 1.15 } : { scale: 1 }}
        transition={{ duration: 0.2 }}
      >
        <Upload className="h-8 w-8 text-[var(--dm-primary)]" />
      </motion.div>

      <p className="text-sm text-slate-600">
        Drag &amp; drop files here, or{' '}
        <span className="text-[var(--dm-primary)] underline">browse</span>
      </p>
      <p className="text-xs text-slate-400">Accepted: {ACCEPTED_TYPES.join(', ')}</p>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED_TYPES.join(',')}
        className="hidden"
        onChange={onChange}
        aria-label="Upload documents"
      />
    </motion.div>
  );
}
