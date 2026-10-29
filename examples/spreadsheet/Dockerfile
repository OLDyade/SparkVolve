ARG HARNESS_IMAGE=sparkvolve:local
FROM ${HARNESS_IMAGE}
RUN apt-get update && apt-get install -y --no-install-recommends python3-venv libreoffice-calc && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/spreadsheet && /opt/spreadsheet/bin/pip install --no-cache-dir openpyxl==3.1.5 et-xmlfile==2.0.0
ENV PATH="/opt/spreadsheet/bin:${PATH}"
