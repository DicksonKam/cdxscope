import { join } from 'node:path';
import { Store } from './store.ts';
import { identityFactory } from './privacy.ts';
import { scan } from './scanner.ts';
const dir=process.env.CDXSCOPE_DATA_DIR!;
const store=new Store(join(dir,'cdxscope.sqlite'));
try {
 await scan(store,identityFactory(dir),process.env.CDXSCOPE_LOG_ROOT?[process.env.CDXSCOPE_LOG_ROOT]:undefined);
} finally {store.close();}
