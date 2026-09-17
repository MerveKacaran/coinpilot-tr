"""Render / Gunicorn entry point."""
import os
from coinpilot_web import app

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', '10000')), threaded=True)
