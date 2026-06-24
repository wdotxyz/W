"""MongoDB connection + module-wide logger."""
import os
import logging
from motor.motor_asyncio import AsyncIOMotorClient
from core.config import ROOT_DIR  # noqa: F401 (ensures .env is loaded first)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger('w')

_mongo_url = os.environ['MONGO_URL']
mongo_client = AsyncIOMotorClient(_mongo_url)
db = mongo_client[os.environ['DB_NAME']]
