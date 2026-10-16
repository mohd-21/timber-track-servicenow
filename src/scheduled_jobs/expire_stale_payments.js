/**
 * Scheduled Script Execution: Expire stale payment links
 * Run: Daily (or hourly)
 */
new TimberTrackPayment().expireStale();
