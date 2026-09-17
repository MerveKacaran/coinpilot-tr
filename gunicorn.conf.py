# One shared market feed/cache; threaded requests keep quotes responsive during scans.
workers = 1
worker_class = 'gthread'
threads = 8
timeout = 90
accesslog = '-'
errorlog = '-'
