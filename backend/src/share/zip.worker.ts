import { parentPort, workerData } from 'worker_threads';
import * as archiver from 'archiver';
import * as fs from 'fs';

async function createZip() {
  try {
    const { shareId, files, shareDirectory, compressionLevel } = workerData;
    const path = `${shareDirectory}/${shareId}`;

    const archive = archiver('zip', {
      zlib: { level: compressionLevel },
    });
    const writeStream = fs.createWriteStream(`${path}/archive.zip`);

    for (const file of files) {
      archive.append(fs.createReadStream(`${path}/${file.id}`), {
        name: file.name,
      });
    }

    archive.pipe(writeStream);
    await archive.finalize();

    if (parentPort) {
      parentPort.postMessage('done');
    }
  } catch (error) {
    if (parentPort) {
      // Send error message or object
      parentPort.postMessage({ error: error instanceof Error ? error.message : String(error) });
    }
    process.exit(1);
  }
}

createZip();
