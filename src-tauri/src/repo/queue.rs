use tokio::sync::{mpsc, oneshot};

use crate::error::AppError;

type Task = Box<dyn FnOnce() + Send + 'static>;

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

        tokio::spawn(async move {
            while let Some(task) = receiver.recv().await {
                let _ = tokio::task::spawn_blocking(move || {
                    task();
                })
                .await;
            }
        });

        Self { sender }
    }

    /// Submit a write operation to the sequential FIFO queue and await its completion.
    pub async fn run<F, R>(&self, f: F) -> Result<R, AppError>
    where
        F: FnOnce() -> Result<R, AppError> + Send + 'static,
        R: Send + 'static,
    {
        let (tx, rx) = oneshot::channel();
        let task = Box::new(move || {
            let res = f();
            let _ = tx.send(res);
        });

        self.sender
            .send(task)
            .map_err(|_| AppError::internal("Write queue closed"))?;

        rx.await
            .map_err(|_| AppError::internal("Write task cancelled or dropped"))?
    }

    /// Blocking variant for synchronous contexts.
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

    #[tokio::test]
    async fn test_sequential_execution() {
        let queue = RepoWriteQueue::new();
        let counter = Arc::new(AtomicUsize::new(0));

        let mut handles = Vec::new();
        for _ in 0..10 {
            let c = counter.clone();
            let q = queue.clone();
            handles.push(tokio::spawn(async move {
                q.run(move || {
                    let current = c.fetch_add(1, Ordering::SeqCst);
                    Ok(current)
                })
                .await
            }));
        }

        for h in handles {
            let res = h.await.unwrap().unwrap();
            assert!(res < 10);
        }

        assert_eq!(counter.load(Ordering::SeqCst), 10);
    }
}
