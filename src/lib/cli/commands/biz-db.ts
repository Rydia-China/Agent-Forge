import { registry } from '../registry';
import * as bizSchemaService from '@/lib/services/biz-schema-service';

registry.register({
  name: 'biz-db:list-tables',
  description: 'List all registered biz-db tables',
  handler: async () => {
    const tables = await bizSchemaService.listSchemas();
    console.log(JSON.stringify(tables, null, 2));
  },
});

registry.register({
  name: 'biz-db:get-schema',
  description: 'Get schema details for a table',
  schema: bizSchemaService.GetSchemaParams,
  handler: async (args) => {
    const params = args as { tableName: string };
    const schema = await bizSchemaService.getSchema(params.tableName);
    console.log(JSON.stringify(schema, null, 2));
  },
});

registry.register({
  name: 'biz-db:create-table',
  description: 'Create a new biz-db table',
  schema: bizSchemaService.CreateTableParams,
  handler: async (args) => {
    const result = await bizSchemaService.createTable(args as Parameters<typeof bizSchemaService.createTable>[0]);
    console.log(JSON.stringify(result, null, 2));
  },
});

registry.register({
  name: 'biz-db:alter-table',
  description: 'Alter an existing biz-db table',
  schema: bizSchemaService.AlterTableParams,
  handler: async (args) => {
    const result = await bizSchemaService.alterTable(args as Parameters<typeof bizSchemaService.alterTable>[0]);
    console.log(JSON.stringify(result, null, 2));
  },
});

registry.register({
  name: 'biz-db:drop-table',
  description: 'Drop a biz-db table',
  schema: bizSchemaService.DropTableParams,
  handler: async (args) => {
    const params = args as { tableName: string };
    await bizSchemaService.dropTable(params);
    console.log('Table dropped successfully');
  },
});

registry.register({
  name: 'biz-db:diff-schema',
  description: 'Compare declared schema vs physical table',
  schema: bizSchemaService.DiffSchemaParams,
  handler: async (args) => {
    const params = args as { tableName: string };
    const diff = await bizSchemaService.diffSchema(params.tableName);
    console.log(JSON.stringify(diff, null, 2));
  },
});
