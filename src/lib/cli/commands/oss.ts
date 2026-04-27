import { registry } from '../registry';
import * as ossService from '@/lib/services/oss-service';

registry.register({
  name: 'oss:upload-url',
  description: 'Upload a file from URL to OSS',
  schema: ossService.UploadFromUrlParams,
  handler: async (args) => {
    const params = args as { url: string; folder: string; filename?: string };
    const result = await ossService.uploadFromUrl(params.url, params.folder, params.filename);
    console.log(JSON.stringify(result, null, 2));
  },
});

registry.register({
  name: 'oss:upload-base64',
  description: 'Upload a base64 data URL to OSS',
  schema: ossService.UploadBase64Params,
  handler: async (args) => {
    const params = args as { data: string; filename: string; folder: string };
    const dataUrl = params.data.startsWith('data:') ? params.data : `data:application/octet-stream;base64,${params.data}`;
    const url = await ossService.uploadDataUrl(dataUrl, params.folder);
    console.log(JSON.stringify({ url }, null, 2));
  },
});

registry.register({
  name: 'oss:delete',
  description: 'Delete an object from OSS',
  schema: ossService.DeleteObjectParams,
  handler: async (args) => {
    const params = args as { objectName: string };
    await ossService.deleteObject(params.objectName);
    console.log('Object deleted successfully');
  },
});
