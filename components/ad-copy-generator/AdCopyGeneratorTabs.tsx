'use client';

import { useState } from 'react';
import { PenTool, Video } from 'lucide-react';
import AdCopyGeneratorClient from './AdCopyGeneratorClient';
import VideoAdCopyClient from './VideoAdCopyClient';

export default function AdCopyGeneratorTabs() {
  const [tab, setTab] = useState<'text' | 'video'>('text');

  return (
    <div>
      <div className="px-6 pt-4 flex gap-2 border-b border-gray-100">
        <button
          onClick={() => setTab('text')}
          className={`flex items-center gap-1.5 text-sm font-medium px-3 py-2 border-b-2 -mb-px transition-colors ${tab === 'text' ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
        >
          <PenTool size={14} /> Text / Photo
        </button>
        <button
          onClick={() => setTab('video')}
          className={`flex items-center gap-1.5 text-sm font-medium px-3 py-2 border-b-2 -mb-px transition-colors ${tab === 'video' ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
        >
          <Video size={14} /> Video
        </button>
      </div>

      {tab === 'text' ? <AdCopyGeneratorClient /> : <VideoAdCopyClient />}
    </div>
  );
}
