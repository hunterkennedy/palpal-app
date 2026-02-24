'use client';

import React, { useState, useEffect } from 'react';
import { Edit3, Save, X, FileText } from 'lucide-react';
import { getChunkNotes, updateChunkNotes } from '@/lib/cookies';

interface ChunkNotesProps {
  chunkId: string;
  isCompact?: boolean;
}

export default function ChunkNotes({ chunkId, isCompact = false }: ChunkNotesProps) {
  const [notes, setNotes] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [tempNotes, setTempNotes] = useState('');

  useEffect(() => {
    const savedNotes = getChunkNotes(chunkId);
    setNotes(savedNotes);
    setTempNotes(savedNotes);
  }, [chunkId]);

  const handleEdit = () => {
    setTempNotes(notes);
    setIsEditing(true);
  };

  const handleSave = () => {
    updateChunkNotes(chunkId, tempNotes);
    setNotes(tempNotes);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setTempNotes(notes);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  };

  if (isCompact) {
    return (
      <div className="flex items-center gap-2">
        {notes && !isEditing && (
          <div className="flex items-center gap-1 text-xs px-2 py-1 rounded-full"
               style={{
                 backgroundColor: 'var(--surface-secondary)',
                 color: 'var(--text-muted)'
               }}>
            <FileText className="w-3 h-3" />
            <span className="max-w-20 truncate">{notes}</span>
          </div>
        )}

        {!isEditing ? (
          <button
            onClick={handleEdit}
            className="p-1 rounded transition-colors"
            style={{ color: 'var(--text-muted)' }}
            onMouseOver={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
            onMouseOut={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
            title={notes ? 'Edit note' : 'Add note'}
          >
            <Edit3 className="w-4 h-4" />
          </button>
        ) : (
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={tempNotes}
              onChange={(e) => setTempNotes(e.target.value)}
              onKeyDown={handleKeyDown}
              className="text-xs px-2 py-1 rounded border w-24"
              style={{
                backgroundColor: 'var(--surface-primary)',
                borderColor: 'var(--border-primary)',
                color: 'var(--text-primary)'
              }}
              placeholder="Add note..."
              autoFocus
            />
            <button
              onClick={handleSave}
              className="p-1 rounded transition-colors"
              style={{ color: 'var(--accent-primary)' }}
              title="Save (Ctrl+Enter)"
            >
              <Save className="w-3 h-3" />
            </button>
            <button
              onClick={handleCancel}
              className="p-1 rounded transition-colors"
              style={{ color: 'var(--text-muted)' }}
              title="Cancel (Esc)"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mt-3">
      {!isEditing ? (
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            {notes ? (
              <div className="p-3 rounded-lg border"
                   style={{
                     backgroundColor: 'var(--surface-secondary)',
                     borderColor: 'var(--border-primary)'
                   }}>
                <div className="flex items-center gap-2 mb-2">
                  <FileText className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                  <span className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
                    Your Note
                  </span>
                </div>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                  {notes}
                </p>
              </div>
            ) : (
              <div className="p-3 rounded-lg border border-dashed"
                   style={{
                     borderColor: 'var(--border-primary)',
                     color: 'var(--text-muted)'
                   }}>
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  <span className="text-sm">No notes yet</span>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={handleEdit}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors"
            style={{
              backgroundColor: 'var(--surface-secondary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-primary)'
            }}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--surface-elevated)'}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'var(--surface-secondary)'}
          >
            <Edit3 className="w-4 h-4" />
            {notes ? 'Edit Note' : 'Add Note'}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
            <span className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
              {notes ? 'Edit Note' : 'Add Note'}
            </span>
          </div>

          <textarea
            value={tempNotes}
            onChange={(e) => setTempNotes(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full p-3 rounded-lg border resize-none text-sm"
            style={{
              backgroundColor: 'var(--surface-primary)',
              borderColor: 'var(--border-primary)',
              color: 'var(--text-primary)',
              minHeight: '80px'
            }}
            placeholder="Write your notes about this chunk..."
            autoFocus
          />

          <div className="flex items-center justify-between">
            <span className="text-xs" style={{ color: 'var(--text-subtle)' }}>
              Press Ctrl+Enter to save, Esc to cancel
            </span>

            <div className="flex items-center gap-2">
              <button
                onClick={handleCancel}
                className="px-3 py-2 rounded-lg text-sm transition-colors"
                style={{
                  backgroundColor: 'var(--surface-secondary)',
                  color: 'var(--text-muted)',
                  border: '1px solid var(--border-primary)'
                }}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--surface-elevated)'}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'var(--surface-secondary)'}
              >
                Cancel
              </button>

              <button
                onClick={handleSave}
                className="px-3 py-2 rounded-lg text-sm transition-colors text-white"
                style={{ backgroundColor: 'var(--accent-primary)' }}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--accent-secondary)'}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'var(--accent-primary)'}
              >
                Save Note
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}