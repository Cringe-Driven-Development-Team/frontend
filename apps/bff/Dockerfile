# Образ BFF: сборки BFF и клиента одного коммита. Собирается из корня монорепы: bun run image
FROM oven/bun:1.4.4-alpine
WORKDIR /app
COPY apps/bff/dist/bff.js /app/bff.js
COPY apps/client/dist/index.html /app/client/index.html
# Публичные файлы (PUBLIC_FILES в src/public.ts) копировались бы в /app/client/public/ — пока их нет
USER bun
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:3000/health || exit 1
CMD ["bun", "bff.js"]
