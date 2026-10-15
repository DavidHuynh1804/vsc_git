use tokio::sync::mpsc;

use crate::error::AppError;

type Task = Box<dyn FnOnce() + Send + 'static>;

/// Sequential FIFO write queue per repository.
///
/// All write operations (`stage`, `commit`, `checkout`, sync, …) are enqueued
/// and executed serially on a dedicated worker thread running a tokio
/// current-thread runtime. This prevents `index.lock` contention between
/// concurrent commands. Read operations run directly and concurrently,
/// bypassing the queue entirely.
#[derive(Clone)]
pub struct RepoWriteQueue {
    sender: mpsc::UnboundedSender<Task>,
}

impl Default for RepoWriteQueue {
    fn default() -> Self {
        Self::new()
    }
}

impl RepoWriteQueue {
    pub fn new() -> Self {
        let (sender, mut receiver) = mpsc::unbounded_channel::<Task>();

        // Own tokio runtime so the queue works whether or not Tauri's async
        // runtime is initialized (e.g. from sync commands or unit tests).
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("failed to build write-queue tokio runtime");

        let _ = std::thread::Builder::new()
            .name("repo-write-queue".into())
            .spawn(move || {
                rt.block_on(async move {
                    while let Some(task) = receiver.recv().await {
                        let _ = tokio::task::spawn_blocking(task).await;
                    }
                });
            });

        Self { sender }
    }

    /// Submit a write operation to the sequential FIFO queue and await its completion.
    pub fn run_blocking<F, R>(&self, f: F) -> Result<R, AppError>
    where
        F: FnOnce() -> Result<R, AppError> + Send + 'static,
        R: Send + 'static,
    {
        let (tx, rx) = std::sync::mpsc::channel();
        let task = Box::new(move || {
            let res = f();
            let _ = tx.send(res);
        });

        self.sender
            .send(task)
            .map_err(|_| AppError::internal("Write queue closed"))?;

        rx.recv()
            .map_err(|_| AppError::internal("Write task cancelled or dropped"))?
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    #[test]
    fn test_sequential_execution() {
        let queue = RepoWriteQueue::new();
        let counter = Arc::new(AtomicUsize::new(0));

        let mut handles = Vec::new();
        for _ in 0..10 {
            let c = counter.clone();
            let q = queue.clone();
            handles.push(std::thread::spawn(move || {
                q.run_blocking(move || {
                    let current = c.fetch_add(1, Ordering::SeqCst);
                    Ok(current)
                })
                .unwrap()
            }));
        }

        for h in handles {
            let res = h.join().unwrap();
            assert!(res < 10);
        }

        assert_eq!(counter.load(Ordering::SeqCst), 10);
    }
}
