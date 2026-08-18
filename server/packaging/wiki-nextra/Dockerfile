# Static CB8 docs (Nextra build) served by nginx. No Node runtime in production —
# `next build` (output: export) emits ./out, which is baked into the image.
#
# Build the static site first (on the build host):
#   pnpm install && pnpm build      # produces ./out
# then:
#   docker build -t registry.s8njee.com/cb8-wiki-nextra:<tag> .
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY out/ /usr/share/nginx/html/
EXPOSE 80
