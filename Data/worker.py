
import threading
import time
from datetime import datetime
import typing
from .tokens import TokenManager
class Worker:
    def __init__(self, name, wait_time, token: TokenManager, out_path):
        self.base_folder = out_path
        self.name = name
        self.wait_time = wait_time
        self.token = token

    def run(self):
        while True:
            print(f"[{datetime.now():%H:%M:%S}] {self.name}: Doing job...")

            # Replace this with your actual job
            time.sleep(self.wait_time)

            print(f"{self.name}: Job finished")


workers = [
    Worker("Worker-1", 2),
    Worker("Worker-2", 5),
    Worker("Worker-3", 8),
]

threads = []

for worker in workers:
    thread = threading.Thread(
        target=worker.run,
        daemon=False
    )
    thread.start()
    threads.append(thread)

# Keep the main program alive
for thread in threads:
    thread.join()
