import { useMemo } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { DataCard } from '@/components/ui/DataCard';
import type { ChartDataset } from './types';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler);

type Props = {
  title: string;
  subtitle: string;
  labels: string[];
  datasets: ChartDataset[];
};

export default function TimelineChart({ title, subtitle, labels, datasets }: Props) {
  const chartData = useMemo(
    () => ({
      labels,
      datasets: datasets.map((item) => ({
        label: item.label,
        data: item.data,
        borderColor: item.borderColor,
        backgroundColor: item.backgroundColor || item.borderColor,
        pointRadius: 1.5,
        pointHoverRadius: 4,
        borderWidth: 2,
        tension: 0.25,
        fill: false,
        yAxisID: item.yAxisID || 'y',
      })),
    }),
    [labels, datasets]
  );

  const chartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index' as const,
        intersect: false,
      },
      plugins: {
        legend: {
          labels: {
            color: '#a3a3a3',
          },
        },
        tooltip: {
          enabled: true,
        },
      },
      scales: {
        x: {
          ticks: { color: '#a3a3a3', maxTicksLimit: 10 },
          grid: { color: 'rgba(255,255,255,0.08)' },
        },
        y: {
          ticks: { color: '#a3a3a3' },
          grid: { color: 'rgba(255,255,255,0.08)' },
        },
        y2: {
          position: 'right' as const,
          ticks: { color: '#a3a3a3' },
          grid: { drawOnChartArea: false },
        },
      },
    }),
    []
  );

  return (
    <DataCard title={title} subtitle={subtitle}>
      {!labels.length ? (
        <div className="rounded-md border border-borderSubtle bg-bgApp px-4 py-8 text-center text-sm text-textMuted">
          No timeline data in selected window
        </div>
      ) : (
        <div className="h-64 rounded-md border border-borderSubtle bg-bgApp/60 p-3">
          <Line data={chartData} options={chartOptions} />
        </div>
      )}
    </DataCard>
  );
}
