function LoadingDots({ label = 'Loading' }) {
  return (
    <span className="dashboard-loading-dots" aria-label={label}>
      <span>.</span>
      <span>.</span>
      <span>.</span>
    </span>
  );
}

export default LoadingDots;
