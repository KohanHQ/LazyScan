# Structure

```json
apps/
  web/
    src/
      main.ts              # app bootstrap
      app.ts               # router + layout wiring

      pages/
        home.ts            # currently reading / queue
        manga.ts           # manga detail + chapter list
        reader.ts          # image reader
        login.ts

      components/
        header.ts
        progress.ts
        button.ts
        modal.ts

      api/
        client.ts          # fetch wrapper
        auth.ts
        manga.ts
        chapter.ts

      state/
        session.ts         # auth user
        reader.ts          # current chapter / page
        queue.ts           # reading queue

      router/
        index.ts           # route definitions
        guards.ts          # auth guard

      styles/
        base.css
        reader.css

      utils/
        dom.ts
        time.ts
        debounce.ts

    index.html
    vite.config.ts
    tsconfig.json
```
