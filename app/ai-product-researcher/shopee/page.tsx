import { ShoppingBag } from 'lucide-react';
import ComingSoon from '@/components/ai-research/ComingSoon';

export const metadata = { title: 'Shopee Research — RPJ Corp' };

export default function ShopeeResearchPage() {
  return (
    <ComingSoon
      title="Shopee Research"
      subtitle="Analyze Shopee listings and suppliers for winning potential"
      icon={ShoppingBag}
      fields={['Keyword Search', 'Shopee Product URL', 'Supplier URL', 'Image Upload']}
      buttonLabel="Analyze Product"
    />
  );
}
