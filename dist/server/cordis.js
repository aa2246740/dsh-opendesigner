/**
 * In-process host used by unit tests. This is not DeepSeek Harness.
 * Production loads `src/plugin.ts` into an unmodified DSH Context.
 */
export class Context {
    tools;
    _events = new Map();
    constructor(options = {}) {
        Object.assign(this, options);
    }
    provide(name, value) {
        this[name] = value;
    }
    on(event, callback) {
        const list = this._events.get(event) || [];
        list.push(callback);
        this._events.set(event, list);
        return () => {
            const idx = list.indexOf(callback);
            if (idx !== -1)
                list.splice(idx, 1);
        };
    }
    emit(event, ...args) {
        const list = this._events.get(event) || [];
        for (const fn of list) {
            fn(...args);
        }
    }
}
//# sourceMappingURL=cordis.js.map