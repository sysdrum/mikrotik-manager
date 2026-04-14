import { InfluxDB, WriteApi, QueryApi } from '@influxdata/influxdb-client';

const url = process.env.INFLUXDB_URL || 'http://influxdb:8086';
const token = process.env.INFLUXDB_TOKEN || '';
const org = process.env.INFLUXDB_ORG || 'mikrotik-manager';
const bucket = process.env.INFLUXDB_BUCKET || 'metrics';

let influxClient: InfluxDB | null = null;
let writeClient: WriteApi | null = null;
let queryClient: QueryApi | null = null;

export function getInfluxClient(): InfluxDB {
  if (!influxClient) {
    influxClient = new InfluxDB({ url, token });
  }
  return influxClient;
}

export function getWriteApi(): WriteApi {
  if (!writeClient) {
    writeClient = getInfluxClient().getWriteApi(org, bucket, 'ns');
    writeClient.useDefaultTags({ source: 'mikrotik-manager' });
  }
  return writeClient;
}

export function getQueryApi(): QueryApi {
  if (!queryClient) {
    queryClient = getInfluxClient().getQueryApi(org);
  }
  return queryClient;
}

export { bucket, org };
