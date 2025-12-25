import dotenv from 'dotenv';
dotenv.config();

import app from './server.js';

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Backend listening on http://localhost:${port}`));
