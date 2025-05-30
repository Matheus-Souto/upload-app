'use client';

import { useState, useEffect } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { toast } from 'sonner';

interface FileUpload {
  id: string;
  fileName: string;
  status: 'pending' | 'processing' | 'completed' | 'error' | 'cancelled';
  createdAt: string;
  result?: string;
}

interface QueueStatus {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  total: number;
  isProcessing: boolean;
  error?: boolean;
}

interface AxiosError extends Error {
  response?: {
    data?: {
      error?: string;
    };
  };
}

export default function DashboardPage() {
  const { status } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  // Polling para atualizar uploads em tempo real
  useEffect(() => {
    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ['uploads'] });
    }, 3000); // Atualiza a cada 3 segundos

    return () => clearInterval(interval);
  }, [queryClient]);

  // Buscar histórico de uploads
  const { data: uploads, isLoading: isLoadingUploads } = useQuery<FileUpload[]>(
    {
      queryKey: ['uploads'],
      queryFn: async () => {
        const response = await axios.get('/api/uploads');
        return response.data;
      },
    },
  );

  // Buscar estatísticas da fila a cada 3 segundos
  const { data: queueStats } = useQuery<QueueStatus>({
    queryKey: ['queue-stats'],
    queryFn: async () => {
      const response = await fetch('/api/queue-stats');
      if (!response.ok) {
        throw new Error('Erro ao buscar estatísticas da fila');
      }
      const data = await response.json();
      return data.stats;
    },
    refetchInterval: 3000,
  });

  // Mutação para upload de arquivo
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);

      const response = await axios.post('/api/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        onUploadProgress: progressEvent => {
          const progress = progressEvent.total
            ? Math.round((progressEvent.loaded * 100) / progressEvent.total)
            : 0;
          setUploadProgress(progress);
        },
      });

      return response.data;
    },
    onSuccess: data => {
      setSelectedFile(null);
      setUploadProgress(0);

      // Invalidar e refetch da lista de uploads
      queryClient.invalidateQueries({ queryKey: ['uploads'] });

      // Toast de sucesso
      toast.success('Arquivo adicionado à fila!', {
        description: `${data.fileName} foi adicionado à fila de processamento. Acompanhe o status no histórico.`,
      });
    },
    onError: (error: AxiosError) => {
      setUploadProgress(0);

      // Toast de erro
      toast.error('Erro no processamento', {
        description:
          error.response?.data?.error ||
          'Ocorreu um erro ao processar o arquivo.',
      });
    },
  });

  // Mutação para cancelar upload
  const cancelMutation = useMutation({
    mutationFn: async (uploadId: string) => {
      const response = await axios.put(
        `/api/uploads?id=${uploadId}&action=cancel`,
      );
      return response.data;
    },
    onSuccess: () => {
      // Invalidar e refetch da lista de uploads
      queryClient.invalidateQueries({ queryKey: ['uploads'] });

      // Toast de sucesso
      toast.success('Upload cancelado com sucesso!');
    },
    onError: (error: AxiosError) => {
      // Toast de erro
      toast.error('Erro ao cancelar upload', {
        description:
          error.response?.data?.error ||
          'Ocorreu um erro ao cancelar o upload.',
      });
    },
  });

  // Mutação para excluir upload
  const deleteMutation = useMutation({
    mutationFn: async (uploadId: string) => {
      const response = await axios.delete(`/api/uploads?id=${uploadId}`);
      return response.data;
    },
    onSuccess: () => {
      // Invalidar e refetch da lista de uploads
      queryClient.invalidateQueries({ queryKey: ['uploads'] });

      // Toast de sucesso
      toast.success('Upload excluído com sucesso!');
    },
    onError: (error: AxiosError) => {
      // Toast de erro
      toast.error('Erro ao excluir upload', {
        description:
          error.response?.data?.error || 'Ocorreu um erro ao excluir o upload.',
      });
    },
  });

  const validateFile = (file: File) => {
    if (file.type !== 'application/pdf') {
      toast.error('Tipo de arquivo inválido', {
        description: 'Por favor, selecione um arquivo PDF válido.',
      });
      return false;
    }
    return true;
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && validateFile(file)) {
      setSelectedFile(file);
    }
  };

  const handleUpload = async () => {
    if (selectedFile) {
      uploadMutation.mutate(selectedFile);
    }
  };

  const handleCancel = async (uploadId: string, fileName: string) => {
    if (window.confirm(`Tem certeza que deseja cancelar "${fileName}"?`)) {
      cancelMutation.mutate(uploadId);
    }
  };

  const handleDelete = async (uploadId: string, fileName: string) => {
    if (window.confirm(`Tem certeza que deseja excluir "${fileName}"?`)) {
      deleteMutation.mutate(uploadId);
    }
  };

  // Funções para drag and drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (validateFile(file)) {
        setSelectedFile(file);
      }
    }
  };

  if (status === 'loading') {
    return <div>Carregando...</div>;
  }

  if (status === 'unauthenticated') {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header com botão de logout */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-8">
          <div className="flex justify-between items-center">
            <h1 className="text-3xl font-bold text-gray-800">
              Sistema de Upload de PDF
            </h1>
            <button
              onClick={() => signOut({ callbackUrl: '/login' })}
              className="bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700"
            >
              Sair
            </button>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-lg p-6 mb-8">
          <h2 className="text-2xl font-bold mb-4 text-gray-800">
            Upload de Arquivo PDF
          </h2>

          <div className="space-y-4">
            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
                isDragOver
                  ? 'border-indigo-500 bg-indigo-50'
                  : selectedFile
                  ? 'border-green-500 bg-green-50'
                  : 'border-gray-300 hover:border-indigo-400 hover:bg-gray-50'
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <input
                type="file"
                accept=".pdf"
                onChange={handleFileChange}
                className="hidden"
                id="file-upload"
              />

              <div className="space-y-4">
                <div className="flex flex-col items-center">
                  <svg
                    className={`w-12 h-12 mb-4 ${
                      isDragOver
                        ? 'text-indigo-500'
                        : selectedFile
                        ? 'text-green-500'
                        : 'text-gray-400'
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>

                  {isDragOver ? (
                    <p className="text-lg font-medium text-indigo-600">
                      Solte o arquivo aqui
                    </p>
                  ) : selectedFile ? (
                    <div className="text-center">
                      <p className="text-lg font-medium text-green-600 mb-2">
                        Arquivo selecionado
                      </p>
                      <p className="text-sm text-gray-600">
                        {selectedFile.name}
                      </p>
                    </div>
                  ) : (
                    <div className="text-center">
                      <p className="text-lg font-medium text-gray-600 mb-2">
                        Arraste e solte seu arquivo PDF aqui
                      </p>
                      <p className="text-sm text-gray-500 mb-4">
                        ou clique para selecionar
                      </p>
                      <label
                        htmlFor="file-upload"
                        className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 cursor-pointer"
                      >
                        Selecionar Arquivo
                      </label>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {selectedFile && (
              <button
                onClick={handleUpload}
                disabled={uploadMutation.isPending}
                className="w-full bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 disabled:opacity-50"
              >
                {uploadMutation.isPending ? 'Enviando...' : 'Enviar Arquivo'}
              </button>
            )}

            {uploadProgress > 0 && uploadProgress < 100 && (
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div
                  className="bg-indigo-600 h-2.5 rounded-full"
                  style={{ width: `${uploadProgress}%` }}
                ></div>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-lg p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl font-bold text-gray-800">
              Histórico de Uploads
            </h2>

            {/* Status da fila */}
            {queueStats && (
              <div className="flex items-center space-x-2">
                {queueStats.isProcessing && (
                  <div className="flex items-center text-blue-600">
                    <svg
                      className="w-4 h-4 mr-1 animate-spin"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                      />
                    </svg>
                    Processando
                  </div>
                )}

                {queueStats.waiting > 0 && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                    {queueStats.waiting} aguardando
                  </span>
                )}

                {queueStats.active > 0 && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                    {queueStats.active} ativo
                  </span>
                )}

                {queueStats.failed > 0 && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                    {queueStats.failed} falhas
                  </span>
                )}

                {!queueStats.isProcessing && queueStats.total === 0 && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                    Fila vazia
                  </span>
                )}
              </div>
            )}
          </div>

          {isLoadingUploads ? (
            <p className="text-gray-700">Carregando histórico...</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Arquivo
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Data
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Ações
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {uploads?.map(upload => (
                    <tr key={upload.id}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-800 font-medium">
                        {upload.fileName}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                            upload.status === 'completed'
                              ? 'bg-green-100 text-green-800'
                              : upload.status === 'error'
                              ? 'bg-red-100 text-red-800'
                              : upload.status === 'processing'
                              ? 'bg-yellow-100 text-yellow-800'
                              : upload.status === 'pending'
                              ? 'bg-blue-100 text-blue-800'
                              : upload.status === 'cancelled'
                              ? 'bg-gray-100 text-gray-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {upload.status === 'completed'
                            ? 'Processado'
                            : upload.status === 'error'
                            ? 'Erro'
                            : upload.status === 'processing'
                            ? 'Processando'
                            : upload.status === 'pending'
                            ? 'Na Fila'
                            : upload.status === 'cancelled'
                            ? 'Cancelado'
                            : 'Pendente'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                        {new Date(upload.createdAt).toLocaleDateString('pt-BR')}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <div className="flex items-center space-x-2">
                          {upload.result && (
                            <a
                              href={upload.result}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center px-3 py-1 border border-transparent text-sm leading-4 font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                              title="Visualizar resultado"
                            >
                              <svg
                                className="w-4 h-4"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                                />
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                                />
                              </svg>
                            </a>
                          )}

                          {upload.status === 'pending' && (
                            <button
                              onClick={() =>
                                handleCancel(upload.id, upload.fileName)
                              }
                              disabled={cancelMutation.isPending}
                              className="inline-flex items-center px-3 py-1 border border-transparent text-sm leading-4 font-medium rounded-md text-white bg-orange-600 hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500 disabled:opacity-50 disabled:cursor-not-allowed"
                              title="Cancelar upload"
                            >
                              <svg
                                className="w-4 h-4"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M6 18L18 6M6 6l12 12"
                                />
                              </svg>
                            </button>
                          )}

                          <button
                            onClick={() =>
                              handleDelete(upload.id, upload.fileName)
                            }
                            disabled={deleteMutation.isPending}
                            className="inline-flex items-center px-3 py-1 border border-transparent text-sm leading-4 font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Excluir upload"
                          >
                            <svg
                              className="w-4 h-4"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                              />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
