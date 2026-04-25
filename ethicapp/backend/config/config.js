const dbconnString = "tcp://postgres:postgres@postgresql:5432/ethicapp";
const uploadsPath = process.env.UPLOADS_PATH || "uploads";

export { dbconnString, uploadsPath };
