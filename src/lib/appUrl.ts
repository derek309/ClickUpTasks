// The app's public address, for links built on the server where there is no
// request to read an origin from: notification emails, the reminder cron, review
// links drafted by Claude over MCP. One place instead of a copy in each file.
export const APP_URL = (process.env.APP_URL || "https://clickuptasks.vercel.app").replace(/\/+$/, "");
