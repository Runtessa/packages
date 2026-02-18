type StatusBannersProps = {
  error: string;
  success: string;
};

export const StatusBanners = ({ error, success }: StatusBannersProps) => {
  return (
    <>
      {error ? <div className="rounded-xl border border-[#F28B82] bg-[#FDECEA] px-4 py-3 text-sm text-[#B3261E]">{error}</div> : null}
      {success ? <div className="rounded-xl border border-[#81C995] bg-[#E6F4EA] px-4 py-3 text-sm text-[#137333]">{success}</div> : null}
    </>
  );
};
