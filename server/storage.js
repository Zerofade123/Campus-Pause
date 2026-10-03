export function db(env){if(!env.DB)throw Error('Database unavailable');return env.DB;}
export const first=(env,sql,...args)=>db(env).prepare(sql).bind(...args).first();
export const run=(env,sql,...args)=>db(env).prepare(sql).bind(...args).run();
export const all=async(env,sql,...args)=>(await db(env).prepare(sql).bind(...args).all()).results;
