# Build the dashboard, then drop it next to R in the runtime image.

FROM node:22-slim AS web

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json ./
COPY public ./public
COPY src ./src
RUN npm run build


FROM ubuntu:24.04 AS runtime

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production

# R comes from apt as prebuilt binaries, which is far quicker and steadier than
# compiling the tidyverse from source. fontconfig and a real font are needed or
# every label ggplot draws comes out blank.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      fontconfig \
      fonts-dejavu-core \
      libcairo2 \
      libfontconfig1 \
      libfreetype6 \
      libjpeg-turbo8 \
      libpng16-16t64 \
      libtiff6 \
      r-base-core \
      r-cran-cowplot \
      r-cran-scales \
      r-cran-tidyverse \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && fc-cache -f \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY R ./R
COPY --from=web /app/dist ./dist

# Jobs are scratch data, so they live outside the code tree.
ENV JOBS_DIR=/tmp/jobs
ENV PORT=10000
EXPOSE 10000

# Fail fast at boot if the image somehow lacks a working R.
RUN Rscript -e 'library(tidyverse); library(cowplot); library(scales); cat("r ok\n")'

CMD ["node", "server/index.js"]
