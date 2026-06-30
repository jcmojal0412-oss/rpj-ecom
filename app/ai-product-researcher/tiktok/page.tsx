import { Music2 } from 'lucide-react';
import ComingSoon from '@/components/ai-research/ComingSoon';

export const metadata = { title: 'TikTok Research — RPJ Corp' };

export default function TikTokResearchPage() {
  return (
    <ComingSoon
      title="TikTok Research"
      subtitle="Discover trending products and viral angles from TikTok"
      icon={Music2}
      fields={['Keyword', 'TikTok URL', 'Season', 'Category']}
      buttonLabel="Analyze Trend"
    />
  );
}
