FROM apache/kafka:3.9.0

USER root
RUN mkdir -p /opt/jmx
ADD https://repo1.maven.org/maven2/io/prometheus/jmx/jmx_prometheus_javaagent/1.0.0/jmx_prometheus_javaagent-1.0.0.jar /opt/jmx/jmx_prometheus_javaagent.jar
COPY config/jmx_config.yml /opt/jmx/jmx_config.yaml
RUN chown -R 1000:1000 /opt/jmx
USER 1000