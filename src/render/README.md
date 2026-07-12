# render

The unified markdown → HTML pipeline and cross-doc link rewriting.

One render code path is used for both dev and prod so there is no
dev/build divergence. Content is rendered at request time, never baked into
the deploy artifact.
