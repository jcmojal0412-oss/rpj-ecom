'use client';

import { useCallback, useState, useRef, useEffect } from 'react';
import {
  DndContext, DragEndEvent, DragOverEvent, DragStartEvent,
  DragOverlay, PointerSensor, useSensor, useSensors, closestCorners,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable,
} from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { CheckCircle, XCircle, ExternalLink, Pencil, Trash2, X, GripVertical } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { getStatusColor } from '@/lib/statusColors';
import type { ResearchItem, ResearchStatus } from './ProductResearchClient';
import type { ResearchStatusRecord } from './StatusManager';

interface Props {
  items: ResearchItem[];
  statuses: ResearchStatusRecord[];
  onStatusChange: (id: number, status: ResearchStatus) => void;
  onEdit: (item: ResearchItem) => void;
  onDelete: (id: number) => void;
  onAddToColumn: (status: ResearchStatus) => void;
  onRefresh: () => void;
}

export default function KanbanBoard({ items, statuses, onStatusChange, onEdit, onDelete, onAddToColumn, onRefresh }: Props) {
  const [activeItem, setActiveItem] = useState<ResearchItem | null>(null);
  const [addingTo, setAddingTo] = useState<ResearchStatus | null>(null);
  const COLUMNS = statuses.map(s => s.name);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const id = Number(event.active.id);
    setActiveItem(items.find(i => i.id === id) ?? null);
  }, [items]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveItem(null);
    const { active, over } = event;
    if (!over) return;
    const activeId = Number(active.id);
    const overId   = String(over.id);

    if (COLUMNS.includes(overId as ResearchStatus)) {
      const cur = items.find(i => i.id === activeId)?.status;
      if (cur !== overId) onStatusChange(activeId, overId as ResearchStatus);
      return;
    }
    const overItem   = items.find(i => i.id === Number(overId));
    const activeCard = items.find(i => i.id === activeId);
    if (overItem && activeCard && overItem.status !== activeCard.status) {
      onStatusChange(activeId, overItem.status);
    }
  }, [items, onStatusChange]);

  const handleDragOver = useCallback((_: DragOverEvent) => {}, []);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {statuses.map(s => (
          <DroppableColumn
            key={s.name}
            col={s.name}
            color={s.color}
            items={items.filter(i => i.status === s.name)}
            onEdit={onEdit}
            onDelete={onDelete}
            onAddModal={() => onAddToColumn(s.name)}
            isAdding={addingTo === s.name}
            onStartAdd={() => setAddingTo(s.name)}
            onCancelAdd={() => setAddingTo(null)}
            onSaved={() => { setAddingTo(null); onRefresh(); }}
          />
        ))}
      </div>

      <DragOverlay dropAnimation={{ duration: 200, easing: 'cubic-bezier(0.25, 1, 0.5, 1)' }}>
        {activeItem ? (
          <div className="bg-white rounded-lg p-3 shadow-2xl border-2 border-orange-300 rotate-2 cursor-grabbing w-72">
            <div className="flex items-center gap-1.5">
              <GripVertical size={14} className="text-gray-300 shrink-0" />
              <p className="text-sm font-semibold text-gray-900 truncate">{activeItem.product_name}</p>
            </div>
            {(activeItem.cogs || activeItem.srp) && (
              <div className="flex items-center gap-2 text-xs text-gray-600 mt-1.5 ml-5">
                {activeItem.cogs && <span>COGS: <span className="font-medium">{formatCurrency(activeItem.cogs)}</span></span>}
                {activeItem.srp  && <span>SRP: <span className="font-medium text-green-700">{formatCurrency(activeItem.srp)}</span></span>}
              </div>
            )}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

// ── Droppable Column ─────────────────────────────────────────────────────────

function DroppableColumn({ col, color, items, onEdit, onDelete, onAddModal, isAdding, onStartAdd, onCancelAdd, onSaved }: {
  col: string;
  color: string;
  items: ResearchItem[];
  onEdit: (item: ResearchItem) => void;
  onDelete: (id: number) => void;
  onAddModal: () => void;
  isAdding: boolean;
  onStartAdd: () => void;
  onCancelAdd: () => void;
  onSaved: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col });
  const colors = getStatusColor(color);

  return (
    <div
      ref={setNodeRef}
      className={`rounded-xl border-2 transition-colors min-h-[300px] p-3 flex flex-col ${
        isOver ? 'border-orange-400 bg-orange-50/30' : colors.bg
      }`}
    >
      {/* Column header */}
      <div className={`flex items-center justify-between mb-3 px-2 py-1 rounded-lg ${colors.header}`}>
        <span className="text-xs font-semibold">{col}</span>
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-bold w-5 h-5 flex items-center justify-center rounded-full bg-white/60">
            {items.length}
          </span>
          {/* Full form button (modal) */}
          <button
            onClick={onAddModal}
            className="w-5 h-5 flex items-center justify-center rounded-full bg-white/70 hover:bg-white transition-colors text-gray-600 font-bold text-sm"
            title="Add with full details"
          >
            +
          </button>
        </div>
      </div>

      {/* Cards */}
      <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-2 flex-1">
          {items.map(item => (
            <DraggableCard key={item.id} item={item} onEdit={onEdit} onDelete={onDelete} />
          ))}

          {items.length === 0 && !isAdding && (
            <div className={`flex items-center justify-center rounded-lg border-2 border-dashed min-h-[60px] transition-colors ${
              isOver ? 'border-orange-400' : 'border-gray-300/50'
            }`}>
              <p className="text-xs text-gray-400">Drop here</p>
            </div>
          )}
        </div>
      </SortableContext>

      {/* Inline quick-add form */}
      {isAdding ? (
        <QuickAddCard status={col} onSaved={onSaved} onCancel={onCancelAdd} />
      ) : (
        <button
          onClick={onStartAdd}
          className="w-full mt-2 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-gray-300 text-xs text-gray-400 hover:border-orange-400 hover:text-orange-500 hover:bg-white/60 transition-colors"
        >
          <span className="text-base leading-none">+</span> Add card
        </button>
      )}
    </div>
  );
}

// ── Inline Quick-Add Form ─────────────────────────────────────────────────────

function QuickAddCard({ status, onSaved, onCancel }: {
  status: ResearchStatus;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await fetch('/api/product-research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_name: name.trim(), status }),
      });
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 bg-white rounded-lg p-2.5 shadow border border-orange-300">
      <textarea
        ref={inputRef}
        className="w-full text-sm rounded border border-gray-200 px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-orange-400"
        placeholder="Product name..."
        rows={2}
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSave(); }
          if (e.key === 'Escape') onCancel();
        }}
      />
      <div className="flex items-center gap-1.5 mt-2">
        <button
          onClick={handleSave}
          disabled={saving || !name.trim()}
          className="px-3 py-1 bg-orange-500 text-white text-xs font-medium rounded-lg hover:bg-orange-600 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Adding...' : 'Add Card'}
        </button>
        <button
          onClick={onCancel}
          className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
        >
          <X size={14} />
        </button>
      </div>
      <p className="text-xs text-gray-400 mt-1.5">Enter ↵ to save · Esc to cancel</p>
    </div>
  );
}

// ── Draggable Card ────────────────────────────────────────────────────────────

function isUrl(str: string) {
  try { return str.startsWith('http://') || str.startsWith('https://'); } catch { return false; }
}

function CardLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:underline truncate max-w-full"
      onClick={e => e.stopPropagation()}
      onPointerDown={e => e.stopPropagation()}
    >
      <ExternalLink size={10} className="shrink-0" />
      <span className="truncate">{label}</span>
    </a>
  );
}

function DraggableCard({ item, onEdit, onDelete }: {
  item: ResearchItem;
  onEdit: (item: ResearchItem) => void;
  onDelete: (id: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    transition: { duration: 150, easing: 'cubic-bezier(0.25, 1, 0.5, 1)' },
  });

  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group bg-white rounded-lg shadow-sm border border-gray-100 select-none transition-all ${
        isDragging ? 'opacity-30 shadow-xl scale-[1.02]' : 'hover:shadow-md hover:border-gray-200'
      }`}
      {...attributes}
      {...listeners}
    >
      {/* Card body — draggable AND clickable to edit (dnd-kit distinguishes drag vs click by movement distance) */}
      <div className="p-3 pb-1 cursor-grab active:cursor-grabbing" onClick={() => onEdit(item)}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-1.5 flex-1 min-w-0">
            <GripVertical size={14} className="text-gray-300 group-hover:text-gray-400 shrink-0 mt-0.5 transition-colors" />
            <h3 className="text-sm font-semibold text-gray-900 leading-tight hover:text-orange-600 transition-colors">
              {item.product_name}
            </h3>
          </div>
          <div title={item.image_ready ? 'Image ready' : 'No image yet'}>
            {item.image_ready
              ? <CheckCircle size={14} className="text-green-600 shrink-0" />
              : <XCircle size={14} className="text-gray-300 shrink-0" />}
          </div>
        </div>

        <div className="mt-2 space-y-1.5">
          {(item.cogs || item.srp) && (
            <div className="flex items-center gap-2 text-xs text-gray-600">
              {item.cogs && <span>COGS: <span className="font-medium">{formatCurrency(item.cogs)}</span></span>}
              {item.srp  && <span>SRP: <span className="font-medium text-green-700">{formatCurrency(item.srp)}</span></span>}
            </div>
          )}

          {/* Clickable links */}
          {item.drive_link && (
            <CardLink href={item.drive_link} label="📁 Google Drive" />
          )}
          {item.google_link && (
            <CardLink href={item.google_link} label="🔍 Research Link" />
          )}
          {item.supplier_details && isUrl(item.supplier_details) && (
            <CardLink href={item.supplier_details} label="🏪 Supplier Link" />
          )}
          {item.supplier_details && !isUrl(item.supplier_details) && (
            <p className="text-xs text-gray-500 truncate">🏪 {item.supplier_details}</p>
          )}
          {item.fb_page_name && isUrl(item.fb_page_name) && (
            <CardLink href={item.fb_page_name} label="📘 FB Page" />
          )}
          {item.fb_page_name && !isUrl(item.fb_page_name) && (
            <p className="text-xs text-gray-500 truncate">📘 {item.fb_page_name}</p>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-1 px-3 py-2 border-t border-gray-100 mt-1">
        <button
          onPointerDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); onEdit(item); }}
          className="p-1 rounded hover:bg-orange-50 text-gray-400 hover:text-orange-500 transition-colors"
          title="Edit"
        >
          <Pencil size={12} />
        </button>
        <button
          onPointerDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); if (confirm('Delete this product?')) onDelete(item.id); }}
          className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
          title="Delete"
        >
          <Trash2 size={12} />
        </button>
        <span className="text-xs text-gray-300 ml-auto">drag to move · click to edit</span>
      </div>
    </div>
  );
}
