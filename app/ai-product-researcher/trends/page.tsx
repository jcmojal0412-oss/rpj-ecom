import ComingSoon from '@/components/ai-research/ComingSoon';

export const metadata = { title: 'Trend Dashboard — RPJ Corp' };

export default function TrendDashboardPage() {
  return (
    <ComingSoon
      title="Trend Dashboard"
      subtitle="Daily auto-discovered trending products across Shopee & TikTok"
      icon="trends"
      fields={['Keyword', 'Season', 'Category', 'Source (Shopee / TikTok / Both)']}
      buttonLabel="Scan Trends"
    />
  );
}
