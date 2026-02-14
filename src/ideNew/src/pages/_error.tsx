import type { NextPageContext } from 'next';

type ErrorPageProps = {
  statusCode: number;
};

function ErrorPage({ statusCode }: ErrorPageProps) {
  const title =
    statusCode === 404
      ? 'Page not found'
      : statusCode >= 500
      ? 'Internal server error'
      : 'Unexpected error';

  return (
    <div className="flex min-h-screen items-center justify-center bg-bgApp px-6 text-textPrimary">
      <div className="w-full max-w-lg rounded-xl border border-borderSubtle bg-bgSurface px-6 py-8 text-center">
        <h1 className="text-3xl font-semibold">{statusCode}</h1>
        <p className="mt-2 text-sm text-textMuted">{title}</p>
      </div>
    </div>
  );
}

ErrorPage.getInitialProps = ({ res, err }: NextPageContext): ErrorPageProps => {
  const statusCode = res?.statusCode ?? err?.statusCode ?? 500;
  return { statusCode };
};

export default ErrorPage;
