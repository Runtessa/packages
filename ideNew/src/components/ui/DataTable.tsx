import React from 'react';

type DataTableProps = {
  headers: string[];
  children: React.ReactNode;
  loading?: boolean;
  emptyMessage?: string;
  size?: 'sm' | 'md';
};

export const DataTable = ({
  headers,
  children,
  loading = false,
  emptyMessage = 'No data to display',
  size = 'md'
}: DataTableProps) => {
  const rowCount = React.Children.count(children);
  const pad = size === 'sm' ? 'px-3 py-2' : 'px-4 py-3';

  return (
    <div className="overflow-x-auto rounded-xl border border-borderSubtle bg-bgSurface">
      <table className="w-full border-collapse text-left text-sm text-textPrimary">
        <thead className="bg-bgApp text-textMuted">
          <tr>
            {headers.map((header) => (
              <th key={header} className={`${pad} font-semibold`}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-borderSubtle">
          {loading ? (
            <tr>
              <td className={`${pad} text-textMuted`} colSpan={headers.length}>
                Loading...
              </td>
            </tr>
          ) : rowCount > 0 ? (
            children
          ) : (
            <tr>
              <td className={`${pad} text-textMuted`} colSpan={headers.length}>
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

export default DataTable;
